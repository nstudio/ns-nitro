import { NativeScriptConfig } from '@nativescript/core';

export default {
  id: 'org.nativescript.nsnitro',
  appPath: 'src',
  appResourcesPath: 'App_Resources',
  android: {
    v8Flags: '--expose_gc',
    markingMode: 'none'
  },
  ios: {
    SPMPackages: [
      {
        name: 'NativeScriptNitro',
        libs: ['NativeScriptNitro'],
        path: '.',
      },
    ],
  },
  bundler: 'vite',
  bundlerConfigPath: 'vite.config.mts',
} as NativeScriptConfig;