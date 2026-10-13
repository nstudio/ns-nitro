import { Application } from '@nativescript/core';

const PHONE_MAX_POINTS = 600;

export function lockPhonesToPortrait(): void {
  Application.ios.addDelegateHandler(
    'applicationSupportedInterfaceOrientationsForWindow',
    (_application: UIApplication, window: UIWindow | null) => {
      const { width, height } = (window?.windowScene?.screen ?? UIScreen.mainScreen).bounds.size;
      return Math.min(width, height) < PHONE_MAX_POINTS ? UIInterfaceOrientationMask.Portrait : UIInterfaceOrientationMask.All;
    },
  );
}
