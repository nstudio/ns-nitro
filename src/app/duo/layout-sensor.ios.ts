import { View } from '@nativescript/core';

@NativeClass()
class LayoutSensorView extends UIView {
  onLayout: (() => void) | null;

  layoutSubviews(): void {
    super.layoutSubviews();
    this.onLayout?.();
  }
}

/**
 * Invisible subview covering `host` that reports every native layout pass. NativeScript's
 * layoutChanged only fires on frame changes, but UIKit also re-runs layout for state read
 * during layout, such as reserved regions, that carries no notification of its own.
 */
export class LayoutSensor {
  readonly native: UIView;

  constructor(host: View, onLayout: () => void) {
    const hostNative = host.nativeViewProtected as UIView;
    const sensor = LayoutSensorView.new() as LayoutSensorView;
    sensor.frame = hostNative.bounds;
    sensor.autoresizingMask = UIViewAutoresizing.FlexibleWidth | UIViewAutoresizing.FlexibleHeight;
    sensor.userInteractionEnabled = false;
    sensor.hidden = true;
    sensor.onLayout = onLayout;
    // Appended, not inserted first: NativeScript places children by native subview index, and a
    // leading extra subview would push later-inserted siblings beneath earlier ones.
    hostNative.addSubview(sensor);
    this.native = sensor;
  }

  dispose(): void {
    (this.native as LayoutSensorView).onLayout = null;
    this.native.removeFromSuperview();
  }
}
