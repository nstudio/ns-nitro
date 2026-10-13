import { View } from '@nativescript/core';
import { DuoBarEdge, DuoFold, DuoPose } from './fold';

export interface HingeReading {
  /** False on any device without a hinge. */
  supported: boolean;
  pose: DuoPose;
  /** Radians: 0 closed, π fully open. Null until the hinge has reported. */
  angle: number | null;
}

export interface HingeListener {
  onHinge(reading: HingeReading): void;
  /** The fold across the tracked root, in its coordinates, and the edge the vertical bar sits on. */
  onRegions(fold: DuoFold | null, barEdge: DuoBarEdge): void;
}

/**
 * Streams the device's hinge and fold geometry to a listener, for as long as `root` is on
 * screen: UIHingeInteraction and reserved regions on iOS, the hinge angle sensor and Jetpack
 * WindowManager's folding feature on Android.
 */
export declare class HingeTracker {
  constructor(root: View, listener: HingeListener);
  dispose(): void;
}

/** The active fold crossing `view`, in that view's own coordinates; null when it lies outside. */
export declare function foldWithin(view: View): DuoFold | null;

/**
 * Width of the strip along `view`'s trailing edge that system chrome covers (vertical bars,
 * status items, the camera). 0 when nothing active overlaps the view, and always on Android.
 */
export declare function trailingOcclusion(view: View): number;
