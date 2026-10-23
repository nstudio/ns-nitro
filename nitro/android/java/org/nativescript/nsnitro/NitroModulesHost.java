package org.nativescript.nsnitro;

import com.facebook.soloader.nativeloader.NativeLoader;
import com.facebook.soloader.nativeloader.SystemDelegate;
import com.margelo.nitro.JNIOnLoad;

/** Installs Nitro Modules v1 and this app's Hybrid Objects into NativeScript's JS runtime. */
public final class NitroModulesHost {
  static {
    // fbjni's HybridData loads libfbjni through NativeLoader, which needs a delegate outside React Native.
    NativeLoader.initIfUninitialized(new SystemDelegate());
    System.loadLibrary("fbjni");
    System.loadLibrary("nativescript-jsi");
    JNIOnLoad.initializeNativeNitro();
    System.loadLibrary("nsnitromodules");
  }

  private NitroModulesHost() {}

  /** Must run on the JS thread, before anything imports nitro-core. */
  public static boolean install() {
    return nativeInstall();
  }

  private static native boolean nativeInstall();
}
