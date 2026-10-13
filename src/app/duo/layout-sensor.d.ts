import { View } from '@nativescript/core';

/** Reports every native layout pass of `host`, not only frame changes. iOS only. */
export declare class LayoutSensor {
  /** The sensor's own native view, sharing the host's bounds. */
  readonly native: any;
  constructor(host: View, onLayout: () => void);
  dispose(): void;
}
