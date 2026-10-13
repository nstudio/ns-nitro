import { Injectable, computed, signal } from '@angular/core';
import { View } from '@nativescript/core';
import { DuoBarEdge, DuoFold, DuoPose } from './fold';
import { HingeTracker, foldWithin, trailingOcclusion } from './hinge-tracker';

export type { DuoBarEdge, DuoFold, DuoPose } from './fold';

@Injectable({ providedIn: 'root' })
export class DuoService {
  /** False on any device without a hinge, and on iOS before 27.1. */
  readonly supported = signal(false);
  readonly pose = signal<DuoPose>('unknown');
  /** Radians: 0 closed, π fully open. Streams continuously while the device is being folded. */
  readonly hingeAngle = signal<number | null>(null);
  /** Active fold across the attached root view. */
  readonly fold = signal<DuoFold | null>(null);
  readonly barEdge = signal<DuoBarEdge>('none');

  readonly hingeDegrees = computed(() => {
    const angle = this.hingeAngle();
    return angle === null ? null : Math.round((angle * 180) / Math.PI);
  });

  readonly poseLabel = computed(() => {
    switch (this.pose()) {
      case 'closed':
        return 'Closed';
      case 'folded':
        return this.fold()?.axis === 'horizontal' ? 'Tabletop' : 'Book';
      case 'open':
        return 'Open';
      default:
        return 'Standard';
    }
  });

  private tracker: HingeTracker | null = null;

  attach(view: View): void {
    this.detach();
    if (!view.nativeViewProtected) {
      return;
    }
    this.tracker = new HingeTracker(view, {
      onHinge: ({ supported, pose, angle }) => {
        this.supported.set(supported);
        this.pose.set(pose);
        this.hingeAngle.set(angle);
      },
      onRegions: (fold, barEdge) => {
        if (JSON.stringify(fold) !== JSON.stringify(this.fold())) {
          this.fold.set(fold);
        }
        this.barEdge.set(barEdge);
      },
    });
  }

  detach(): void {
    this.tracker?.dispose();
    this.tracker = null;
  }

  /** The active fold crossing `view`, in that view's own coordinates; null when it lies outside. */
  foldWithin(view: View): DuoFold | null {
    return foldWithin(view);
  }

  /**
   * Width of the strip along `view`'s trailing edge that system chrome covers (vertical bars,
   * status items, the camera). 0 when nothing active overlaps the view.
   */
  trailingOcclusion(view: View): number {
    return trailingOcclusion(view);
  }
}
