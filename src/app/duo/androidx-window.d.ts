/**
 * The slice of Jetpack WindowManager (androidx.window:window and window-java, declared in
 * App_Resources/Android/app.gradle) that the hinge tracker drives. No typings ship for it.
 */
declare module androidx {
  export module window {
    export module layout {
      export class WindowInfoTracker extends java.lang.Object {
        public static getOrCreate(context: android.content.Context): WindowInfoTracker;
        public static Companion: { getOrCreate(context: android.content.Context): WindowInfoTracker };
      }
      export class WindowLayoutInfo extends java.lang.Object {
        public getDisplayFeatures(): java.util.List<DisplayFeature>;
      }
      export class DisplayFeature extends java.lang.Object {
        public getBounds(): android.graphics.Rect;
      }
      /** A hinge or fold. Only some display features are one; check for its methods. */
      export class FoldingFeature extends DisplayFeature {
        /** FoldingFeature.Orientation; its toString() is 'VERTICAL' or 'HORIZONTAL'. */
        public getOrientation(): java.lang.Object;
        /** FoldingFeature.State; its toString() is 'FLAT' or 'HALF_OPENED'. */
        public getState(): java.lang.Object;
        public isSeparating(): boolean;
      }
    }
    export module java {
      export module layout {
        export class WindowInfoTrackerCallbackAdapter extends java.lang.Object {
          public constructor(tracker: androidx.window.layout.WindowInfoTracker);
          public addWindowLayoutInfoListener(
            activity: android.app.Activity,
            executor: java.util.concurrent.Executor,
            consumer: androidx.core.util.Consumer<androidx.window.layout.WindowLayoutInfo>,
          ): void;
          public removeWindowLayoutInfoListener(
            consumer: androidx.core.util.Consumer<androidx.window.layout.WindowLayoutInfo>,
          ): void;
        }
      }
    }
  }
}
