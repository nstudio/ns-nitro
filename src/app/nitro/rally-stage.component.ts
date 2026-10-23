import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NO_ERRORS_SCHEMA,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NativeScriptCommonModule } from '@nativescript/angular';
import { Canvas } from '@nativescript/canvas';
import { EventData, Screen, View } from '@nativescript/core';
import { DuoService } from '../duo/duo.service';
import { haptics } from '../haptics';
import { NitroService } from './nitro.service';
import { RallyAudioEngine } from './rally-audio';
import { drawRallyOverlay } from './rally-car-painter';
import { RallyGpuField } from './rally-gpu';

@Component({
  selector: 'ns-rally-stage',
  templateUrl: './rally-stage.component.html',
  imports: [NativeScriptCommonModule],
  schemas: [NO_ERRORS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RallyStageComponent {
  @Input() compact = false;

  readonly nitro = inject(NitroService);
  readonly duo = inject(DuoService);

  private readonly audio = new RallyAudioEngine();
  private gpuField: RallyGpuField | null = null;
  private overlayCanvas: Canvas | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private stageView: View | null = null;

  private readonly stageSize = signal({ width: 0, height: 0 });
  readonly isFlyingBy = signal(false);
  readonly audioMuted = signal(false);
  readonly liveRpm = signal(6800);
  readonly liveBoostBar = signal(1.8);

  private readonly startedAt = Date.now();
  private flybyStartedAt = -10000;
  private lastTriggerSeen = 0;
  private rafId = 0;
  private wheelPhase = 0;

  readonly duoBadgeText = computed(() => {
    const deg = this.duo.hingeDegrees();
    const pose = this.duo.poseLabel().toUpperCase();
    const prefix = __ANDROID__ ? 'FOLD' : 'DUO';
    if (deg !== null) {
      return `${prefix} ${pose} · ${deg}°`;
    }
    return this.compact ? 'TAP FOR TURBO FLYBY' : `${prefix} ${pose} · STAGE`;
  });

  readonly rpmTelemetryText = computed(
    () =>
      `${this.nitro.formatInt(this.liveRpm())} RPM · +${this.liveBoostBar().toFixed(1)} BAR BOOST`,
  );

  readonly rpmBarPercent = computed(() =>
    Math.min(100, Math.max(18, Math.round(((this.liveRpm() - 3500) / 5200) * 100))),
  );

  constructor() {
    effect(() => {
      const count = this.nitro.flybyTriggerCount();
      if (count > this.lastTriggerSeen) {
        this.lastTriggerSeen = count;
        this.startFlybySequence();
      }
    });
  }

  onStageLoaded(args: EventData): void {
    this.stageView = args.object as View;
    this.audio.start();
    this.measureStage();
    this.startRenderLoop();
  }

  onStageUnloaded(): void {
    this.stopRenderLoop();
    this.gpuField?.dispose();
    this.gpuField = null;
    this.audio.dispose();
  }

  onStageLayout(args: EventData): void {
    this.stageView = args.object as View;
    this.measureStage();
  }

  async onGpuCanvasReady(args: EventData): Promise<void> {
    const canvas = args.object as Canvas;
    const field = await RallyGpuField.create(canvas);
    if (field) {
      this.gpuField = field;
      const { width, height } = this.stageSize();
      if (width > 0 && height > 0) {
        field.resize(width, height, Screen.mainScreen.scale);
      }
    }
  }

  onOverlayCanvasReady(args: EventData): void {
    const canvas = args.object as Canvas;
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    this.resizeOverlayCanvas();
  }

  launchManualFlyby(): void {
    haptics.Medium();
    this.nitro.triggerRallyFlyby('Manual Quattro S1 Crest Jump');
  }

  triggerBenchAndFlyby(event?: EventData): void {
    (event as any)?.ios?.touches?. any;
    haptics.Heavy();
    this.nitro.runFullBenchmarkSuite();
  }

  toggleAudio(event?: EventData): void {
    void event;
    haptics.tick();
    this.audioMuted.set(this.audio.toggleMute());
  }

  private startFlybySequence(): void {
    this.flybyStartedAt = Date.now();
    this.isFlyingBy.set(true);
    this.audio.playFlyby(1.0);
  }

  private measureStage(): void {
    if (!this.stageView) {
      return;
    }
    const actual = this.stageView.getActualSize();
    if (actual.width <= 0 || actual.height <= 0) {
      return;
    }
    const prev = this.stageSize();
    if (Math.abs(prev.width - actual.width) > 0.5 || Math.abs(prev.height - actual.height) > 0.5) {
      this.stageSize.set({ width: actual.width, height: actual.height });
      const dpr = Screen.mainScreen.scale;
      this.gpuField?.resize(actual.width, actual.height, dpr);
      this.resizeOverlayCanvas();
    }
  }

  private resizeOverlayCanvas(): void {
    if (!this.overlayCanvas) {
      return;
    }
    const { width, height } = this.stageSize();
    if (width <= 0 || height <= 0) {
      return;
    }
    const dpr = Screen.mainScreen.scale;
    this.overlayCanvas.width = Math.round(width * dpr);
    this.overlayCanvas.height = Math.round(height * dpr);
  }

  private startRenderLoop(): void {
    if (this.rafId) {
      return;
    }
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      this.renderFrame();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRenderLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private renderFrame(): void {
    const { width, height } = this.stageSize();
    if (width <= 0 || height <= 0) {
      this.measureStage();
      return;
    }

    const now = Date.now();
    const timeSec = (now - this.startedAt) / 1000;
    const elapsedFlyby = now - this.flybyStartedAt;
    const flybyDurationMs = this.audio.flybyDurationMs;
    const inFlyby = elapsedFlyby >= 0 && elapsedFlyby <= flybyDurationMs;

    if (this.isFlyingBy() !== inFlyby) {
      this.isFlyingBy.set(inFlyby);
    }

    // Heroic default airborne crest pose matching racecar.jpeg
    const baseCarX = width * 0.39;
    const baseCarY = height * 0.46;
    const baseScale = Math.min(width / 320, height / 250) * (this.compact ? 0.92 : 1.08);

    let carX = baseCarX + Math.sin(timeSec * 2.2) * 4;
    let carY = baseCarY + Math.cos(timeSec * 3.1) * 3.5;
    let pitch = -0.065 + Math.sin(timeSec * 2.6) * 0.015;
    let scale = baseScale;
    let droop = 0.85;
    let boost = 0.35 + 0.15 * Math.sin(timeSec * 8);
    let cameraShake = 0;
    let flybyProgress = 0;

    if (inFlyby) {
      const p = elapsedFlyby / flybyDurationMs;
      flybyProgress = p;

      // Two-stage trajectory:
      // Phase 1 (0.0 -> 0.68): Charges up from bottom-right dirt slope, launches high over the crest
      //                        and flies past the left edge!
      // Phase 2 (0.68 -> 1.0): Smoothly crests back into the heroic center-left jump pose!
      if (p < 0.68) {
        const u = p / 0.68;
        const ease = 1 - Math.pow(1 - u, 2.2);
        carX = width * 1.12 - (width * 1.38) * ease;
        // Parabolic jump arc peaking right at center-left (u ~ 0.48)
        const jumpArc = Math.sin(u * Math.PI);
        carY = height * 0.68 - jumpArc * (height * 0.30);
        pitch = -0.14 * Math.cos(u * Math.PI * 0.85);
        scale = baseScale * (0.72 + 0.46 * Math.sin(u * Math.PI * 0.75));
        droop = Math.min(1, jumpArc * 1.35);
        boost = 1.0;
        cameraShake = Math.sin(u * Math.PI);
      } else {
        const u = (p - 0.68) / 0.32;
        const smooth = u * u * (3 - 2 * u);
        carX = width * 0.68 + (baseCarX - width * 0.68) * smooth;
        carY = height * 0.56 + (baseCarY - height * 0.56) * smooth;
        pitch = -0.09 + 0.025 * smooth;
        scale = baseScale * (0.88 + 0.12 * smooth);
        droop = 0.6 + 0.25 * smooth;
        boost = 0.85 - 0.45 * smooth;
        cameraShake = (1 - smooth) * 0.4;
      }

      // The C++ synthesizer's own engine state at this point of the flyby, so the gauges match the audio.
      const telemetry = this.audio.quattro.telemetryAt(elapsedFlyby / 1000);
      const targetRpm = Math.round(telemetry.rpm);
      if (Math.abs(targetRpm - this.liveRpm()) > 90) {
        this.liveRpm.set(targetRpm);
        this.liveBoostBar.set(Number(telemetry.boostBar.toFixed(1)));
      }
    } else if (this.liveRpm() !== 6800) {
      this.liveRpm.set(6800);
      this.liveBoostBar.set(1.8);
    }

    this.wheelPhase -= 0.28 + boost * 0.35;

    const shockwaveTime =
      this.flybyStartedAt > 0 ? (this.flybyStartedAt - this.startedAt) / 1000 : -100;

    let webGpuRendered = false;
    if (this.gpuField?.alive) {
      webGpuRendered = this.gpuField.render({
        width,
        height,
        timeSec,
        flybyProgress,
        carX,
        carY,
        carPitchRad: pitch,
        boostEnergy: boost,
        speedupRatio: 14.5,
        dustIntensity: 0.45 + boost * 0.55,
        shockwaveTime,
        hingeOpenness: 1.0,
        cameraShake,
      });
    }

    if (this.overlayCtx) {
      drawRallyOverlay(this.overlayCtx, width, height, Screen.mainScreen.scale, {
        x: carX,
        y: carY,
        pitch,
        scale,
        suspensionDroop: droop,
        wheelPhase: this.wheelPhase,
        boost,
        speedupLabel: this.nitro.averageSpeedup(),
        timeSec,
        hasWebGpuBackdrop: webGpuRendered,
      });
    }
  }
}
