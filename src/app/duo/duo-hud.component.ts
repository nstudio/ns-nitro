import { ChangeDetectionStrategy, Component, NO_ERRORS_SCHEMA, computed, effect, inject } from '@angular/core';
import { NativeScriptCommonModule } from '@nativescript/angular';
import { EventData, View } from '@nativescript/core';
import { symbolImage } from '../icons';
import { DuoService } from './duo.service';

const TRACK_WIDTH = 132;

/** Floating readout of the live device pose; only renders on hardware with a hinge. */
@Component({
  selector: 'ns-duo-hud',
  templateUrl: './duo-hud.component.html',
  imports: [NativeScriptCommonModule],
  schemas: [NO_ERRORS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuoHudComponent {
  readonly duo = inject(DuoService);
  readonly trackWidth = TRACK_WIDTH;

  readonly icon = computed(() => {
    switch (this.duo.pose()) {
      case 'closed':
        return symbolImage('iphone');
      case 'folded':
        return symbolImage(this.duo.fold()?.axis === 'horizontal' ? 'laptopcomputer' : 'book');
      default:
        return symbolImage('rectangle.split.2x1');
    }
  });

  readonly fillWidth = computed(() => {
    const openness = (this.duo.hingeAngle() ?? 0) / Math.PI;
    return Math.max(4, Math.round(TRACK_WIDTH * Math.min(1, openness)));
  });

  /** Centered at the bottom would put the HUD right on a vertical fold; shift to the leading half. */
  private readonly offsetX = computed(() => {
    const fold = this.duo.fold();
    return fold?.axis === 'vertical' ? -(fold.x + fold.width) / 2 : 0;
  });

  private hud: View | null = null;

  constructor() {
    effect(() => {
      const x = this.offsetX();
      this.hud?.animate({ translate: { x, y: 0 }, duration: 380, curve: 'easeInOut' }).catch(() => {});
    });
  }

  onLoaded(args: EventData): void {
    this.hud = args.object as View;
    this.hud.translateX = this.offsetX();
  }
}
