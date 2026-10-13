import {
  ChangeDetectionStrategy,
  Component,
  NO_ERRORS_SCHEMA,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  NativeScriptCommonModule,
  NativeScriptRouterModule,
  RouterExtensions,
} from '@nativescript/angular';
import { NitroService } from './nitro.service';

@Component({
  selector: 'ns-nitro-benchmark-detail',
  templateUrl: './nitro-benchmark-detail.component.html',
  imports: [NativeScriptCommonModule, NativeScriptRouterModule],
  schemas: [NO_ERRORS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NitroBenchmarkDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly routerExtensions = inject(RouterExtensions);
  readonly nitro = inject(NitroService);

  readonly cardId = this.route.snapshot.params['id'] as string;

  readonly card = computed(() =>
    this.nitro.allBenchmarkCards().find((c) => c.id === this.cardId)
  );

  readonly architectureNotes = computed(() => {
    const isAndroid = this.nitro.isAndroid;
    switch (this.cardId) {
      case 'tsc-c-to-c':
        return {
          pathwayHeader: isAndroid
            ? 'C-to-C: JSI HostFunction vs. Node-API (N-API) C Wrapper'
            : 'C-to-C: JSI HostFunction vs. NativeScript Direct C Metadata (CFunction + libffi)',
          cppSnippet: isAndroid
            ? 'Both pathways call the exact same extern "C" ns_c_add(double, double) function with zero JNI or Java objects. JSI uses rnv8::HostFunctionProxy; N-API uses NativeScriptNapiEnv() + napi_get_cb_info.'
            : 'Both pathways call C directly without touching Objective-C or objc_msgSend. NativeScript’s Clang metadata generator exposes ns_direct_c_add(a, b) globally via CFunction + libffi.',
          swiftSnippet: isAndroid
            ? 'Demonstrates pure C function invocation overhead on Android V8: JSI vs. N-API wrapper.'
            : 'Also includes NativeScript Direct C Metadata calling Swift @_cdecl("nitro_swift_add_numbers") with zero Objective-C overhead.',
          takeaway:
            'Apples-to-Apples C-to-C comparison: isolates pure JS-to-C call dispatch without Objective-C or Java marshaling.',
        };
      case 'tsc-zero-copy-c':
        return {
          pathwayHeader: isAndroid
            ? 'Zero-Copy C Pointer: JSI rt.data(ab) vs. N-API napi_get_arraybuffer_info'
            : 'Zero-Copy C Pointer: JSI rt.data(ab) vs. NativeScript interop.handleof(ab)',
          cppSnippet: isAndroid
            ? 'Both JSI (ab.data(rt)) and N-API (napi_get_arraybuffer_info) extract the raw V8 ArrayBuffer backing store pointer in C and run ns_c_dsp in-place with zero byte copies.'
            : 'NativeScript’s interop.handleof(f32.buffer) passes the raw V8 ArrayBuffer pointer directly to C (ns_direct_c_dsp) and Swift SIMD4 (nitro_swift_simd_nbody_step) without allocating NSMutableData.',
          swiftSnippet: isAndroid
            ? 'Once inside C with the raw float* pointer, DSP loop execution time is identical between JSI and N-API.'
            : 'Both JSI and NativeScript interop.handleof() run the exact same Swift 6 SIMD4<Float> + Accelerate vDSP loop in-place.',
          takeaway:
            'Proves that NativeScript iOS already achieves zero-copy C/Swift pointer access today via interop.handleof(buffer), matching JSI ArrayBuffer performance.',
        };
      case 'tsc-swift-or-jni':
        return {
          pathwayHeader: isAndroid
            ? 'JNI-to-JNI: Nitro JNI Call vs. NativeScript Method Call into Java'
            : 'Swift-to-Swift: Nitro → Swift 6 vs. NativeScript → Swift 6',
          cppSnippet: isAndroid
            ? 'Nitro JNI crosses V8 → JSI HostFunction → C++ → JNIEnv::CallStaticDoubleMethod → Java NitroAndroidBridge.addNumbers(a, b).'
            : 'Nitro invokes SwiftEngine.addNumbers via JSI → @_cdecl Swift function.',
          swiftSnippet: isAndroid
            ? 'NativeScript Method Call crosses V8 → NativeScript Metadata Dispatch → JNIEnv → Java NitroAndroidBridge.addNumbers(a, b) on the exact same Java class.'
            : 'NativeScript invokes Swift via two native pathways: Direct C Metadata (@_cdecl nitro_swift_add_numbers) and @objc Swift class method (NSSwiftBenchmarkBridge.addNumbersB).',
          takeaway: isAndroid
            ? 'When both Nitro and NativeScript must cross JNI into Java/Kotlin, both pay the JNI transition cost.'
            : 'Compares calling into Swift via NativeScript (both C-ABI and @objc Swift) directly against Nitro → Swift calling.',
        };
      case 'tsc-equal-marshaling':
        return {
          pathwayHeader: isAndroid
            ? 'Equal String Marshaling: Pure C UTF-8 vs. JNI jstring Roundtrip'
            : 'Equal String Marshaling: Pure C UTF-8 vs. Swift.String & NSString* Roundtrip',
          cppSnippet: isAndroid
            ? 'Separates "just go into C" (JSI C snprintf vs. N-API C snprintf) from "cross JNI and allocate java.lang.String" (Nitro JNI NewStringUTF vs. NativeScript JNI).'
            : 'Separates "just go into C" (Nitro JSI C snprintf vs. NativeScript ns_direct_c_format_utf8) from "construct Swift.String / NSString*" on both sides.',
          swiftSnippet: isAndroid
            ? 'Both Nitro JNI and NativeScript Method Call invoke NitroAndroidBridge.formatRecord(String, double, int) in Java and marshal the resulting String back to V8.'
            : 'Both Nitro (SwiftEngine.formatSwiftString) and NativeScript (NSSwiftBenchmarkBridge.formatSwiftRecord) construct a real Swift.String and run identical Swift string interpolation.',
          takeaway:
            'Demonstrates that string allocation/transcoding (NSString* / Swift.String / jstring) dominates bridge cost whenever either Nitro or NativeScript crosses into platform string types.',
        };
      case 'scalar-100k':
        return {
          pathwayHeader: isAndroid
            ? 'JSI HostFunction vs. Classic JNI Method Dispatch'
            : 'JSI HostFunction vs. libffi + objc_msgSend',
          cppSnippet:
            'rnv8::HostFunctionProxy invokes the C++20 lambda directly with v8::FunctionCallbackInfo, bypassing metadata lookup and argument boxing.',
          swiftSnippet: isAndroid
            ? 'Classic JNI dispatch crosses the V8-to-JVM boundary via CallStaticDoubleMethodv and metadata reflection on java.lang.Math.'
            : '@_cdecl("nitro_swift_add_numbers") compiles to a direct C-ABI function call with unboxed IEEE-754 double registers (d0, d1).',
          takeaway:
            'Proves that NativeScript’s built-in rnv8::V8Runtime achieves the same sub-10ms 100k scalar call regime as Nitro on React Native.',
        };
      case 'zerocopy-simd':
        return {
          pathwayHeader: 'v8::ArrayBuffer::GetBackingStore()->Data()',
          cppSnippet: isAndroid
            ? 'rt.data(ArrayBuffer) returns the raw uint8_t* pointer directly inside V8’s heap backing store so C++20 mutates floats in-place with zero copies.'
            : 'rt.data(ArrayBuffer) returns the raw uint8_t* pointer directly inside V8’s heap backing store. C++20 and Swift mutate floats in-place with zero copies.',
          swiftSnippet: isAndroid
            ? 'Eliminates java.nio.ByteBuffer.allocate() and JNI array marshaling when streaming 64 KB audio/sensor frames.'
            : 'SwiftParticleSystem binds UnsafeMutableRawPointer to SIMD4<Float> hardware registers and runs Accelerate vDSP_rmsqv on the same address.',
          takeaway: isAndroid
            ? 'Eliminates JNI ByteBuffer allocation and memcpy overhead for real-time audio DSP, camera frame pipelines, and physics.'
            : 'Eliminates NSMutableData / NSData allocation and memcpy overhead for real-time audio DSP, camera frame pipelines, and physics.',
        };
      case 'swift-cryptokit':
        return {
          pathwayHeader: 'Pure Swift Value Types (Zero-@objc Exposure)',
          cppSnippet:
            'Passes ab.data(rt) and ab.size(rt) directly from JSI to Swift’s UnsafeRawBufferPointer without creating NSData or NSString.',
          swiftSnippet:
            'CryptoKit.SHA256.hash(data: rawBuffer) executes Apple’s hardware-accelerated ARMv8 SHA instructions on the pure Swift struct.',
          takeaway:
            'Unlocks modern Swift-only Apple frameworks (CryptoKit, WeatherKit, SwiftData, FoundationModels) without writing @objc wrapper classes.',
        };
      case 'string-marshaling':
        return {
          pathwayHeader: isAndroid
            ? 'Direct V8 UTF-8 vs. JNI jstring / StringBuilder Bridging'
            : 'Direct V8 UTF-8 vs. CFString / NSString Bridging',
          cppSnippet:
            'jsi::String::createFromUtf8 and .utf8(rt) stream directly between V8 UTF-8 buffers and std::string / C buffers.',
          swiftSnippet: isAndroid
            ? 'Avoids allocating JVM jstring / java.lang.StringBuilder instances and UTF-16 ↔ Modified UTF-8 transcoding across high-frequency loops.'
            : 'Avoids allocating autoreleased NSString instances across high-frequency loops.',
          takeaway:
            'Ideal for high-frequency JSON/SQLite row serialization and structured telemetry.',
        };
      default:
        return {
          pathwayHeader: 'rnv8::V8Runtime InternalField #2 (kNativeState)',
          cppSnippet:
            'instance.setNativeState(rt, state) stores std::shared_ptr<NativeState> in V8 InternalField #1 with weak GC finalizer and rt.setExternalMemoryPressure().',
          swiftSnippet:
            'Shared prototype methods unwrap thisVal.asObject(rt).getNativeState<T>(rt) in a single pointer read.',
          takeaway: isAndroid
            ? 'Confirms full compatibility with Nitro’s modern HybridObjectPrototype + NativeState object model on NativeScript Android.'
            : 'Confirms full compatibility with Nitro’s modern HybridObjectPrototype + NativeState object model on NativeScript iOS.',
        };
    }
  });

  goBack(): void {
    this.routerExtensions.back();
  }

  rerun(): void {
    this.nitro.runFullBenchmarkSuite();
  }
}
