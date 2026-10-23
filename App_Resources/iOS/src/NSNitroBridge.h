#import <Foundation/Foundation.h>
#include <stdint.h>

NS_ASSUME_NONNULL_BEGIN

// ============================================================================
// APPLES-TO-APPLES (TSC): DIRECT C FUNCTIONS (ZERO OBJECTIVE-C / OBJC_MSGSEND)
// Exposed to JavaScript by NativeScript's C metadata generator (CFunction + libffi)
// ============================================================================
FOUNDATION_EXPORT double ns_direct_c_add(double a, double b);

FOUNDATION_EXPORT double ns_direct_c_dsp(void * _Nullable bufferPtr,
                                         int32_t floatCount,
                                         float gain,
                                         float drive);

FOUNDATION_EXPORT int32_t ns_direct_c_format_utf8(const char * _Nullable labelUtf8,
                                                  double score,
                                                  int32_t index);

// Direct Swift 6 @_cdecl C-ABI functions exposed to NativeScript C metadata
FOUNDATION_EXPORT double nitro_swift_add_numbers(double a, double b);

FOUNDATION_EXPORT double nitro_swift_simd_nbody_step(float * _Nullable bufferPtr,
                                                     intptr_t floatCount,
                                                     float dt,
                                                     intptr_t steps);

@interface NSNitroBridge : NSObject

/// Installs Nitro Modules v1 (nitro-core) and this app's Hybrid Objects into the
/// calling thread's JS runtime. Must run before anything imports nitro-core.
+ (BOOL)installNitro;

/// Installs the NitroModules JSI Host & HybridObject Registry onto the active
/// NativeScript V8 Isolate via +[JSIRuntime runtime].
+ (BOOL)install;

/// Returns whether the Nitro JSI bridge is currently installed on globalThis.
+ (BOOL)isInstalled;

@end

/// Classic NativeScript Objective-C Metadata Interop Baseline for Angle #3 Benchmarks
@interface NSClassicObjCBridge : NSObject

+ (double)addNumbers:(double)a b:(double)b;
+ (NSString *)sha256String:(NSString *)input;
+ (NSString *)formatRecord:(NSString *)name score:(double)score index:(NSInteger)index;
+ (double)stepParticlesObjC:(NSMutableData *)data dt:(float)dt steps:(NSInteger)steps;

@end

NS_ASSUME_NONNULL_END
