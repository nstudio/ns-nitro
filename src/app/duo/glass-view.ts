import { Property, Utils, View } from '@nativescript/core';

export const glassRadiusProperty = new Property<GlassView, number>({
  name: 'glassRadius',
  defaultValue: 0,
  valueConverter: (v) => parseFloat(v),
});

/** Liquid Glass on iOS 26+, system blur before that, translucent fill on Android. */
export class GlassView extends View {
  glassRadius: number;

  createNativeView(): any {
    if (__APPLE__) {
      const effect =
        Utils.SDK_VERSION >= 26
          ? UIGlassEffect.effectWithStyle(UIGlassEffectStyle.Regular)
          : UIBlurEffect.effectWithStyle(UIBlurEffectStyle.SystemThinMaterial);
      const view = UIVisualEffectView.alloc().initWithEffect(effect);
      view.clipsToBounds = true;
      return view;
    }
    const view = new android.view.View(this._context);
    view.setBackground(this.androidBackground(0));
    return view;
  }

  [glassRadiusProperty.setNative](radius: number) {
    const native = this.nativeViewProtected;
    if (!native) {
      return;
    }
    if (__APPLE__) {
      const view = native as UIVisualEffectView;
      if (Utils.SDK_VERSION >= 26) {
        view.cornerConfiguration = UICornerConfiguration.configurationWithUniformRadius(
          UICornerRadius.fixedRadius(radius),
        );
      } else {
        view.layer.cornerRadius = radius;
      }
    } else {
      (native as android.view.View).setBackground(this.androidBackground(radius));
    }
  }

  private androidBackground(radius: number) {
    const background = new android.graphics.drawable.GradientDrawable();
    background.setColor(android.graphics.Color.parseColor('#CC1C1C1E'));
    background.setCornerRadius(Utils.layout.toDevicePixels(radius));
    return background;
  }
}

glassRadiusProperty.register(GlassView);
