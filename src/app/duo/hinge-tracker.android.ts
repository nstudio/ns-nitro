import { Application, Utils, View } from '@nativescript/core';
import { DuoFold, DuoPose, MIN_PANE } from './fold';
import type { HingeListener } from './hinge-tracker';

/** The folding feature last reported for the activity's window, in window pixels. */
interface Feature {
  left: number;
  top: number;
  right: number;
  bottom: number;
  axis: DuoFold['axis'];
  halfOpened: boolean;
  /** False once flat on a device whose halves meet without a gap, such as a Pixel Fold. */
  separating: boolean;
}

let feature: Feature | null = null;

export class HingeTracker {
  private readonly root: WeakRef<View>;
  private manager: android.hardware.SensorManager | null = null;
  private sensorListener: android.hardware.SensorEventListener | null = null;
  private adapter: androidx.window.java.layout.WindowInfoTrackerCallbackAdapter | null = null;
  private consumer: androidx.core.util.Consumer<androidx.window.layout.WindowLayoutInfo> | null = null;
  private angle: number | null = null;
  private informed = false;
  private readonly onLayout = () => this.refresh();

  private hasHingeSensor = false;

  constructor(
    root: View,
    private readonly listener: HingeListener,
  ) {
    this.root = new WeakRef(root);
    const activity = Application.android.foregroundActivity ?? Application.android.startActivity;
    if (!activity) {
      listener.onHinge({ supported: false, pose: 'unknown', angle: null });
      return;
    }

    const manager = activity.getSystemService(android.content.Context.SENSOR_SERVICE) as android.hardware.SensorManager;
    const hinge = manager?.getDefaultSensor(android.hardware.Sensor.TYPE_HINGE_ANGLE);
    if (manager && hinge) {
      this.hasHingeSensor = true;
      this.sensorListener = new android.hardware.SensorEventListener({
        onSensorChanged: (event) => {
          this.angle = (event.values[0] * Math.PI) / 180;
          this.publish();
        },
        onAccuracyChanged: () => {},
      });
      manager.registerListener(this.sensorListener, hinge, android.hardware.SensorManager.SENSOR_DELAY_GAME);
      this.manager = manager;
    }

    try {
      const Tracker = androidx.window.layout.WindowInfoTracker;
      const tracker =
        typeof Tracker.getOrCreate === 'function' ? Tracker.getOrCreate(activity) : Tracker.Companion.getOrCreate(activity);
      this.adapter = new androidx.window.java.layout.WindowInfoTrackerCallbackAdapter(tracker);
      this.consumer = new androidx.core.util.Consumer<androidx.window.layout.WindowLayoutInfo>({
        accept: (info) => this.onLayoutInfo(info),
      });
      this.adapter.addWindowLayoutInfoListener(activity, activity.getMainExecutor(), this.consumer);
    } catch (err) {
      console.warn('WindowInfoTracker unavailable:', err);
    }

    // The fold is reported in window coordinates; the root's own position in the window can move.
    root.on(View.layoutChangedEvent, this.onLayout);
    this.publish();
  }

  dispose(): void {
    this.root.deref()?.off(View.layoutChangedEvent, this.onLayout);
    if (this.manager && this.sensorListener) {
      this.manager.unregisterListener(this.sensorListener);
    }
    if (this.adapter && this.consumer) {
      this.adapter.removeWindowLayoutInfoListener(this.consumer);
    }
    this.manager = null;
    this.sensorListener = null;
    this.adapter = null;
    this.consumer = null;
  }

  private onLayoutInfo(info: androidx.window.layout.WindowLayoutInfo): void {
    feature = readFeature(info);
    this.informed = true;
    this.publish();
    this.refresh();
  }

  /** On a device with a hinge, a window with no fold across it is on the outer display. */
  private publish(): void {
    const supported = this.hasHingeSensor || feature !== null;
    if (!supported) {
      this.listener.onHinge({ supported: false, pose: 'unknown', angle: null });
      return;
    }
    const pose: DuoPose = !this.informed
      ? 'unknown'
      : !feature
        ? 'closed'
        : feature.halfOpened
          ? 'folded'
          : 'open';
    const inferredAngle =
      this.angle ?? (feature ? (feature.halfOpened ? (109 * Math.PI) / 180 : Math.PI) : null);
    this.listener.onHinge({ supported: true, pose, angle: inferredAngle });
  }

  private refresh(): void {
    const root = this.root.deref();
    if (root) {
      this.listener.onRegions(foldWithin(root), 'none');
    }
  }
}

export function foldWithin(view: View): DuoFold | null {
  const native = view?.nativeViewProtected as android.view.View | undefined;
  if (!native || !feature?.separating) {
    return null;
  }
  const location = Array.create('int', 2) as androidNative.Array<number>;
  native.getLocationInWindow(location);
  const dip = Utils.layout.toDeviceIndependentPixels;
  const fold: DuoFold = {
    x: dip(feature.left - location[0]),
    y: dip(feature.top - location[1]),
    width: dip(feature.right - feature.left),
    height: dip(feature.bottom - feature.top),
    axis: feature.axis,
  };
  const before = fold.axis === 'vertical' ? fold.x : fold.y;
  const after =
    fold.axis === 'vertical'
      ? dip(native.getWidth()) - (fold.x + fold.width)
      : dip(native.getHeight()) - (fold.y + fold.height);
  return before < MIN_PANE || after < MIN_PANE ? null : fold;
}

export function trailingOcclusion(_view: View): number {
  return 0;
}

function readFeature(info: androidx.window.layout.WindowLayoutInfo): Feature | null {
  const features = info.getDisplayFeatures();
  for (let i = 0; i < features.size(); i++) {
    const candidate = features.get(i) as androidx.window.layout.FoldingFeature;
    // Display features are a Kotlin interface hierarchy; the runtime exposes only the class.
    if (typeof candidate.getOrientation !== 'function') {
      continue;
    }
    const bounds = candidate.getBounds();
    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      axis: candidate.getOrientation().toString() === 'VERTICAL' ? 'vertical' : 'horizontal',
      halfOpened: candidate.getState().toString() === 'HALF_OPENED',
      separating: candidate.isSeparating(),
    };
  }
  return null;
}
