A NativeScript (Angular + Vite) app that runs [Nitro Modules](https://nitro.margelo.com) v1 **directly inside NativeScript's V8 isolate**, with no React Native dependency.

## How it works

Nitro v1 splits its runtime into `nitro-core`, which has no React Native dependency, and `react-native-nitro-modules`, the React Native host. This app is a NativeScript host for `nitro-core`:

- **JSI runtime**: `@nativescript/ios-jsi` and `@nativescript/android-jsi` (vendored in `vendor/`, from https://github.com/NativeScript/runtimes/pull/76 plus the `feat/jsi-upstream-sync` branch) provide `facebook::jsi` at React Native 0.88's revision on top of NativeScript's V8 isolate, and `tns::JSICallInvoker` to schedule work back onto the JS thread.
- **Host**: `nitro/host/NativeScriptNitro.cpp` adapts `JSICallInvoker` to Nitro's `Dispatcher` and calls `margelo::nitro::install()`. `src/nitro-install.ts` runs it before anything imports `nitro-core`.
- **Specs**: `src/specs/*.nitro.ts` are Nitro v1 class specs. `nitro.json` uses `"environment": "bare"`, so `npm run nitrogen` generates bindings that import `nitro-core`.
- **iOS**: `Package.swift` builds `nitro-core`, the generated bindings, the Swift/C++ implementations and the host into the `NativeScriptNitro` Swift package (linked through `ios.SPMPackages`). It sits at the app root because SwiftPM only compiles sources inside the package directory.
- **Android**: `App_Resources/Android/src/main/cpp/CMakeLists.txt` builds `libNitroModules.so` (nitro-core) and `libnsnitromodules.so` (generated bindings, C++ implementations, host); `app.gradle` adds fbjni via prefab and the Kotlin sources.

## Layout

| Path | What |
| :--- | :--- |
| `src/specs/*.nitro.ts` | Nitro v1 specs (`QuattroEngine`, `CxxBench`, `PlatformBench`) |
| `nitrogen/generated/` | Nitrogen output (regenerate with `npm run nitrogen`) |
| `nitro/cpp/` | C++ Hybrid Objects shared by iOS and Android |
| `nitro/ios/`, `nitro/android/` | Swift and Kotlin Hybrid Objects, Android host glue |
| `nitro/host/` | NativeScript `Dispatcher` and install entry point |
| `App_Resources/iOS/src/JSIShim/` | The earlier hand-written JSI HostObjects, kept as a benchmark baseline |
| `src/app/nitro/` | Dashboard: Nitro v1 vs. hand-written JSI vs. classic NativeScript interop |
| `patches/` | `patch-package` fixes for `@nativescript/vite` and `@analogjs/vite-plugin-angular` |

## Run

```bash
npm install
npm run ios
npm run android
```

After editing a spec, run `npm run nitrogen` and rebuild.

## Why

Classic NativeScript interop is still the most ergonomic way to reach any platform API from TypeScript. Nitro adds a typed fast path for hot loops, zero-copy buffers, shared C++ libraries and pure Swift types that can't be exposed via `@objc`. Both coexist in the same app.
