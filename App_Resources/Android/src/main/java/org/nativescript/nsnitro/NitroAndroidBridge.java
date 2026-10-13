package org.nativescript.nsnitro;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * Apples-to-Apples (TSC) Android Benchmark Bridge.
 *
 * Used by BOTH:
 * 1. NativeScript Method Call (V8 -> NativeScript Metadata -> JNI -> Java)
 * 2. Nitro JNI Call (V8 -> JSI HostFunction -> C++ -> JNIEnv -> Java)
 */
public final class NitroAndroidBridge {
  private static boolean sInstalled = false;

  static {
    try {
      System.loadLibrary("nativescript-jsi");
      System.loadLibrary("nsnitro");
    } catch (Throwable t) {
      android.util.Log.e("NitroAndroidBridge", "Failed to load JSI/nsnitro native libraries", t);
    }
  }

  private NitroAndroidBridge() {}

  public static synchronized boolean install() {
    if (sInstalled) {
      return true;
    }
    try {
      sInstalled = nativeInstall(NitroAndroidBridge.class);
    } catch (Throwable t) {
      android.util.Log.e("NitroAndroidBridge", "nativeInstall failed", t);
    }
    return sInstalled;
  }

  public static double addNumbers(double a, double b) {
    return a + b;
  }

  public static String formatRecord(String label, double score, int index) {
    int pct = (int) (score * 100.0);
    return "[JavaJNI#" + index + "] " + label + " => " + pct;
  }

  public static double processDspByteBuffer(
      ByteBuffer buffer,
      int floatCount,
      float gain,
      float drive
  ) {
    if (buffer == null || floatCount <= 0) {
      return 0.0;
    }
    buffer.order(ByteOrder.nativeOrder());
    FloatBuffer fb = buffer.asFloatBuffer();
    int limit = Math.min(floatCount, fb.remaining());
    float peak = 0.0f;
    float z1 = 0.0f;
    final float alpha = 0.85f;
    for (int i = 0; i < limit; i++) {
      float x = fb.get(i) * gain;
      float xDrive = x * drive;
      float x2 = xDrive * xDrive;
      float saturated = xDrive * (27.0f + x2) / (27.0f + 9.0f * x2);
      float filtered = (1.0f - alpha) * saturated + alpha * z1;
      z1 = filtered;
      fb.put(i, filtered);
      float absVal = Math.abs(filtered);
      if (absVal > peak) {
        peak = absVal;
      }
    }
    return (double) peak;
  }

  private static native boolean nativeInstall(Class<?> bridgeClass);
}
