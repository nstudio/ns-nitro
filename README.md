A NativeScript (Angular + Vite) app that runs [NitroModules](https://nitro.margelo.com) **directly inside NativeScript's V8 isolate**, with no React Native dependency.

https://github.com/user-attachments/assets/f3b2a535-d2f9-406d-9b3f-2e6998e42388

## How it works

NativeScript's iOS and Android runtimes already ship a `facebook::jsi::Runtime` implementation (`rnv8::V8Runtime`) layered over V8. Nitro's `HybridObject` / `HybridObjectRegistry` / `HybridObjectPrototype` are built against that runtime, so Nitro modules bind straight into the same JS context as regular NativeScript code.

- **JSI runtime** — `@nativescript/ios-jsi` and `@nativescript/android-jsi` (vendored in `vendor/`) expose the JSI headers and the active runtime pointer. They include the APIs Nitro needs that the stock runtimes stub out: `jsi::NativeState`, zero-copy `createArrayBuffer(MutableBuffer)` and `setExternalMemoryPressure` (upstream: https://github.com/NativeScript/runtimes/pull/76).
- **Dispatcher** — `NSNitroBridge.mm` replaces React Native's `CallInvokerDispatcher` with a NativeScript-backed `margelo::nitro::Dispatcher`, so promises resolved from C++/Swift threads settle on the V8 thread.
- **Install** — `NSNitroBridge.install()` (iOS) / `installAndroidNitroHostIfNeeded()` (Android) put `NitroModules` on `globalThis`; see `src/app/nitro/nitro.service.ts`.

## Layout

| Path | What |
| :--- | :--- |
| `src/specs/*.nitro.ts` | Nitrogen specs |
| `App_Resources/iOS/src/` | Nitro headers, generated spec, `NSNitroBridge`, Swift 6 engine (`@_cdecl` entry points) |
| `App_Resources/Android/src/main/cpp/` | NDK/JNI host for the Android JSI runtime |
| `src/app/nitro/` | Benchmark dashboard comparing Nitro JSI vs. classic NativeScript interop |
| `patches/` | `patch-package` fixes for `@nativescript/vite` and `@analogjs/vite-plugin-angular` |

## Run

```bash
npm install 
npm run ios  
npm run android
```

## Why

Classic NativeScript interop is still the most ergonomic way to reach any platform API from TypeScript. Nitro adds a fast path for hot loops, zero-copy buffers, shared C++ libraries and pure Swift types that can't be exposed via `@objc`. Both coexist in the same app.
