import {
  bootstrapApplication,
  provideNativeScriptHttpClient,
  provideNativeScriptRouter,
  registerElement,
  runNativeScriptAngularApp,
} from '@nativescript/angular';
import { provideZonelessChangeDetection } from '@angular/core';
import { withInterceptorsFromDi } from '@angular/common/http';
import { Canvas } from '@nativescript/canvas';
import { TouchManager } from '@nativescript/core';
import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { ArrangementView } from './app/duo/arrangement-view';
import { GlassView } from './app/duo/glass-view';
import { lockPhonesToPortrait } from './app/portrait';

if (__ANDROID__) {
  Canvas.useSurface = true;
}

registerElement('ArrangementView', () => ArrangementView);
registerElement('Canvas', () => Canvas);
registerElement('Glass', () => GlassView);
TouchManager.enableGlobalTapAnimations = true;
lockPhonesToPortrait();

runNativeScriptAngularApp({
  appModuleBootstrap: () => {
    return bootstrapApplication(AppComponent, {
      providers: [
        provideNativeScriptHttpClient(withInterceptorsFromDi()),
        provideNativeScriptRouter(routes),
        provideZonelessChangeDetection(),
      ],
    });
  },
});
