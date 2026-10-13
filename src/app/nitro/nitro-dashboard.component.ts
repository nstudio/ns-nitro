import {
  ChangeDetectionStrategy,
  Component,
  NO_ERRORS_SCHEMA,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  NativeScriptCommonModule,
  NativeScriptRouterModule,
} from '@nativescript/angular';
import { EventData, View } from '@nativescript/core';
import { DuoService } from '../duo/duo.service';
import { FoldPanes, foldPanes } from '../duo/fold-panes';
import { NitroService } from './nitro.service';
import { RallyStageComponent } from './rally-stage.component';

@Component({
  selector: 'ns-nitro-dashboard',
  templateUrl: './nitro-dashboard.component.html',
  imports: [NativeScriptCommonModule, NativeScriptRouterModule, RallyStageComponent],
  schemas: [NO_ERRORS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NitroDashboardComponent {
  readonly nitro = inject(NitroService);
  readonly duo = inject(DuoService);

  private hostView: View | null = null;
  readonly panes = signal<FoldPanes | null>(null);

  readonly selectedDrive = signal<number>(2.4);
  readonly selectedCryptoPresetIdx = signal<number>(0);

  readonly cryptoPresets = [
    'NativeScript 9.1 + Nitro JSI + Swift 6 CryptoKit',
    'Zero-ObjC SIMD4 & SHA-256 Telemetry Frame #4096',
    'Write Once in C++/Swift — Run in RN & NativeScript',
  ];

  constructor() {
    effect(() => {
      this.duo.fold();
      this.duo.pose();
      this.measureFoldPanes();
    });
  }

  onHostLayout(args: EventData): void {
    this.hostView = args.object as View;
    this.measureFoldPanes();
  }

  selectTab(tab: 'overview' | 'benchmarks' | 'swift6' | 'zerocopy'): void {
    this.nitro.activeTab.set(tab);
  }

  selectBenchmarkCategory(cat: 'all' | 'tsc-apples' | 'classic'): void {
    this.nitro.benchmarkCategoryFilter.set(cat);
  }

  selectCryptoPreset(idx: number): void {
    this.selectedCryptoPresetIdx.set(idx);
    this.nitro.runPureSwiftCryptoDemo(this.cryptoPresets[idx]);
  }

  selectDspDrive(drive: number): void {
    this.selectedDrive.set(drive);
    this.nitro.runZeroCopyDspAndSimdDemo(drive);
  }

  runFullBenchmarks(): void {
    this.nitro.runFullBenchmarkSuite();
  }

  runAsyncSuite(): void {
    this.nitro.runAsyncConcurrencyShowcase();
  }

  runNativeStateBurst(): void {
    this.nitro.runNativeStateLifecycleBurst(500);
  }

  executeSwift6EnclaveOps(): void {
    const nextIdx = (this.selectedCryptoPresetIdx() + 1) % this.cryptoPresets.length;
    this.selectCryptoPreset(nextIdx);
    this.nitro.runNitrogenSpecDemo();
  }

  stepAudioFrame(): void {
    const nextDrive = this.selectedDrive() === 2.4 ? 4.8 : 2.4;
    this.selectDspDrive(nextDrive);
  }

  private measureFoldPanes(): void {
    const next = this.hostView ? foldPanes(this.hostView) : null;
    if (next?.columns !== this.panes()?.columns) {
      this.panes.set(next);
    }
  }
}
