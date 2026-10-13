import { Application, Utils } from '@nativescript/core';

const PHONE_MAX_DP = 600;

function apply(activity: android.app.Activity | undefined): void {
  if (!activity) {
    return;
  }
  const phone = activity.getResources().getConfiguration().smallestScreenWidthDp < PHONE_MAX_DP;
  const ActivityInfo = android.content.pm.ActivityInfo;
  const wanted = phone ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
  if (activity.getRequestedOrientation() !== wanted) {
    activity.setRequestedOrientation(wanted);
  }
}

export function lockPhonesToPortrait(): void {
  Application.android.on(Application.android.activityCreatedEvent, (args) => apply(args.activity));
  // A foldable moving the window between its displays changes the smallest width without
  // recreating the activity.
  Utils.android.getApplicationContext().registerComponentCallbacks(
    new android.content.ComponentCallbacks({
      onConfigurationChanged: () => apply(Application.android.foregroundActivity),
      onLowMemory: () => {},
    }),
  );
}
