import Foundation
import CryptoKit
import Accelerate
import simd

// ============================================================================
// ANGLE #2: PURE SWIFT VALUE-TYPE & CONCURRENCY ENGINE (ZERO-@OBJC PATHWAY)
// ============================================================================
// None of the types below (CryptoKit.SHA256, HMAC<SHA256>, SymmetricKey,
// SIMD4<Float>, ParticleState, or Swift Structured Concurrency TaskGroup)
// inherit from NSObject or use @objc. They are bridged directly to C++20
// and JSI HybridObjects via C-ABI / Swift-C++ interop.

/// Pure Swift value type (struct) — invisible to Objective-C metadata runtime
public struct SwiftParticleSystem {
    public var attractor: SIMD4<Float>
    public var damping: Float

    @inlinable
    public init(attractor: SIMD4<Float> = SIMD4<Float>(0.0, 0.0, 0.0, 1.0), damping: Float = 0.998) {
        self.attractor = attractor
        self.damping = damping
    }

    /// Mutates a JSI ArrayBuffer's Float32 backing store in-place using hardware SIMD4<Float> lanes
    @inlinable
    public func stepInPlace(buffer: UnsafeMutablePointer<Float>, floatCount: Int, dt: Float, steps: Int) -> Double {
        let vecCount = floatCount / 4
        guard vecCount > 0 else { return 0.0 }

        let rawVecPtr = UnsafeMutableRawPointer(buffer).assumingMemoryBound(to: SIMD4<Float>.self)
        let dtVec = SIMD4<Float>(repeating: dt)
        let dampVec = SIMD4<Float>(repeating: damping)

        for _ in 0..<steps {
            for i in 0..<vecCount {
                var p = rawVecPtr[i]
                let delta = attractor - p
                let distSq = max(simd_length_squared(delta), 0.001)
                let invDist = 1.0 / sqrt(distSq)
                let accel = delta * SIMD4<Float>(repeating: invDist)
                // Symplectic Euler update on SIMD4 lane
                p = (p + accel * dtVec) * dampVec
                rawVecPtr[i] = p
            }
        }

        // Compute total system energy across all SIMD4 vectors
        var totalEnergy: Float = 0.0
        for i in 0..<vecCount {
            totalEnergy += simd_length_squared(rawVecPtr[i])
        }
        return Double(totalEnergy)
    }
}

@inline(__always)
private func writeDigestHex<D: Digest>(_ digest: D, to outHexPtr: UnsafeMutablePointer<CChar>) {
    let hexChars: [CChar] = Array("0123456789abcdef".utf8).map { CChar(bitPattern: $0) }
    var offset = 0
    for byte in digest {
        outHexPtr[offset] = hexChars[Int(byte >> 4)]
        outHexPtr[offset + 1] = hexChars[Int(byte & 0x0F)]
        offset += 2
    }
    outHexPtr[offset] = 0
}

/// Pure Swift scalar call (no NSObject, no objc_msgSend)
@_cdecl("nitro_swift_add_numbers")
public func nitroSwiftAddNumbers(_ a: Double, _ b: Double) -> Double {
    return a + b
}

/// Pure Swift CryptoKit.SHA256 operating directly on a JSI ArrayBuffer / UTF-8 pointer
@_cdecl("nitro_swift_sha256")
public func nitroSwiftSha256(
    _ dataPtr: UnsafePointer<UInt8>,
    _ length: Int,
    _ outHexPtr: UnsafeMutablePointer<CChar>
) {
    let rawBuffer = UnsafeRawBufferPointer(start: dataPtr, count: max(length, 0))
    let digest = SHA256.hash(data: rawBuffer)
    writeDigestHex(digest, to: outHexPtr)
}

/// Pure Swift CryptoKit.HMAC<SHA256> operating directly on raw JSI pointers
@_cdecl("nitro_swift_hmac_sha256")
public func nitroSwiftHmacSha256(
    _ dataPtr: UnsafePointer<UInt8>,
    _ dataLen: Int,
    _ keyPtr: UnsafePointer<UInt8>,
    _ keyLen: Int,
    _ outHexPtr: UnsafeMutablePointer<CChar>
) {
    let dataBuffer = UnsafeRawBufferPointer(start: dataPtr, count: max(dataLen, 0))
    let keyBuffer = UnsafeRawBufferPointer(start: keyPtr, count: max(keyLen, 0))
    let key = SymmetricKey(data: keyBuffer)
    let mac = HMAC<SHA256>.authenticationCode(for: dataBuffer, using: key)
    var offset = 0
    let hexChars: [CChar] = Array("0123456789abcdef".utf8).map { CChar(bitPattern: $0) }
    for byte in mac {
        outHexPtr[offset] = hexChars[Int(byte >> 4)]
        outHexPtr[offset + 1] = hexChars[Int(byte & 0x0F)]
        offset += 2
    }
    outHexPtr[offset] = 0
}

/// Pure Swift SIMD4<Float> + Accelerate zero-copy in-place physics & DSP step
@_cdecl("nitro_swift_simd_nbody_step")
public func nitroSwiftSimdNBodyStep(
    _ bufferPtr: UnsafeMutablePointer<Float>,
    _ floatCount: Int,
    _ dt: Float,
    _ steps: Int
) -> Double {
    let simulator = SwiftParticleSystem(
        attractor: SIMD4<Float>(0.5, -0.25, 0.75, 1.0),
        damping: 0.999
    )
    return simulator.stepInPlace(buffer: bufferPtr, floatCount: floatCount, dt: dt, steps: steps)
}

/// Pure Swift Accelerate vDSP RMS + Spectral Energy on zero-copy Float32Array
@_cdecl("nitro_swift_vdsp_rms")
public func nitroSwiftVdspRms(
    _ bufferPtr: UnsafePointer<Float>,
    _ floatCount: Int
) -> Double {
    guard floatCount > 0 else { return 0.0 }
    var rms: Float = 0.0
    vDSP_rmsqv(bufferPtr, 1, &rms, vDSP_Length(floatCount))
    return Double(rms)
}

public typealias NitroSwiftAsyncCallback = @convention(c) (
    UnsafeMutableRawPointer?,
    Double,
    Double,
    Int32
) -> Void

/// Pure Swift Structured Concurrency (Task + withTaskGroup) bridged to JSI Promise
@_cdecl("nitro_swift_async_task_group")
public func nitroSwiftAsyncTaskGroup(
    _ taskCount: Int32,
    _ iterationsPerTask: Int32,
    _ contextPtr: UnsafeMutableRawPointer?,
    _ callback: NitroSwiftAsyncCallback
) {
    let contextBits = Int(bitPattern: contextPtr)
    let clampedTasks = Int(max(1, min(taskCount, 64)))
    let clampedIters = Int(max(100, iterationsPerTask))

    Task.detached(priority: .userInitiated) {
        let startNs = DispatchTime.now().uptimeNanoseconds

        let combinedValue = await withTaskGroup(of: Double.self, returning: Double.self) { group in
            for taskIdx in 0..<clampedTasks {
                group.addTask {
                    var acc: Double = 0.0
                    let base = Double(taskIdx * clampedIters)
                    for i in 0..<clampedIters {
                        let k = base + Double(i)
                        let term = ((i & 1) == 0 ? 1.0 : -1.0) / (2.0 * k + 1.0)
                        acc += term
                    }
                    return acc * 4.0
                }
            }

            var sum: Double = 0.0
            for await partial in group {
                sum += partial
            }
            return sum
        }

        let endNs = DispatchTime.now().uptimeNanoseconds
        let durationMs = Double(endNs - startNs) / 1_000_000.0
        let restoredContext = UnsafeMutableRawPointer(bitPattern: contextBits)
        callback(restoredContext, combinedValue, durationMs, Int32(clampedTasks))
    }
}

/// Pure Swift CryptoKit.HKDF<SHA256> key derivation (zero-@objc value type)
@_cdecl("nitro_swift_hkdf_sha256")
public func nitroSwiftHkdfSha256(
    _ secretPtr: UnsafePointer<UInt8>,
    _ secretLen: Int,
    _ saltPtr: UnsafePointer<UInt8>,
    _ saltLen: Int,
    _ infoPtr: UnsafePointer<UInt8>,
    _ infoLen: Int,
    _ outHexPtr: UnsafeMutablePointer<CChar>
) {
    let secretBuffer = UnsafeRawBufferPointer(start: secretPtr, count: max(secretLen, 0))
    let saltBuffer = UnsafeRawBufferPointer(start: saltPtr, count: max(saltLen, 0))
    let infoBuffer = UnsafeRawBufferPointer(start: infoPtr, count: max(infoLen, 0))
    let inputKey = SymmetricKey(data: secretBuffer)
    let derivedKey = HKDF<SHA256>.deriveKey(
        inputKeyMaterial: inputKey,
        salt: saltBuffer,
        info: infoBuffer,
        outputByteCount: 32
    )
    let hexChars: [CChar] = Array("0123456789abcdef".utf8).map { CChar(bitPattern: $0) }
    var offset = 0
    derivedKey.withUnsafeBytes { rawBytes in
        for byte in rawBytes {
            outHexPtr[offset] = hexChars[Int(byte >> 4)]
            outHexPtr[offset + 1] = hexChars[Int(byte & 0x0F)]
            offset += 2
        }
    }
    outHexPtr[offset] = 0
}

/// Pure Swift CryptoKit.AES.GCM authenticated encryption (zero-@objc value type)
@_cdecl("nitro_swift_aes_gcm_seal")
public func nitroSwiftAesGcmSeal(
    _ plaintextPtr: UnsafePointer<UInt8>,
    _ plaintextLen: Int,
    _ secretPtr: UnsafePointer<UInt8>,
    _ secretLen: Int,
    _ outHexPtr: UnsafeMutablePointer<CChar>,
    _ maxHexCapacity: Int
) -> Int32 {
    let plainBuffer = UnsafeRawBufferPointer(start: plaintextPtr, count: max(plaintextLen, 0))
    let secretBuffer = UnsafeRawBufferPointer(start: secretPtr, count: max(secretLen, 0))
    let keyDigest = SHA256.hash(data: secretBuffer)
    let symmetricKey = SymmetricKey(data: keyDigest)
    do {
        let sealedBox = try AES.GCM.seal(plainBuffer, using: symmetricKey)
        guard let combined = sealedBox.combined else { return -1 }
        let hexChars: [CChar] = Array("0123456789abcdef".utf8).map { CChar(bitPattern: $0) }
        var offset = 0
        for byte in combined {
            if offset + 2 >= maxHexCapacity { break }
            outHexPtr[offset] = hexChars[Int(byte >> 4)]
            outHexPtr[offset + 1] = hexChars[Int(byte & 0x0F)]
            offset += 2
        }
        outHexPtr[offset] = 0
        return Int32(combined.count)
    } catch {
        outHexPtr[0] = 0
        return -1
    }
}

/// Fills a zero-copy NitroModules::ArrayBuffer directly using CryptoKit SymmetricKey entropy
@_cdecl("nitro_swift_fill_entropy")
public func nitroSwiftFillEntropy(
    _ bufferPtr: UnsafeMutablePointer<UInt8>,
    _ byteLength: Int
) {
    var offset = 0
    while offset < byteLength {
        let key = SymmetricKey(size: .bits256)
        key.withUnsafeBytes { rawBytes in
            let chunk = min(rawBytes.count, byteLength - offset)
            if let base = rawBytes.baseAddress {
                memcpy(bufferPtr.advanced(by: offset), base, chunk)
            }
            offset += chunk
        }
    }
}

/// Apples-to-Apples Swift String formatter: constructs a genuine Swift `String`,
/// performs Swift string interpolation, and writes UTF-8 into `outBuf`.
@_cdecl("nitro_swift_format_record")
public func nitroSwiftFormatRecord(
    _ nameUtf8: UnsafePointer<CChar>,
    _ score: Double,
    _ index: Int,
    _ outBuf: UnsafeMutablePointer<CChar>,
    _ maxCap: Int
) -> Int32 {
    let swiftName = String(cString: nameUtf8)
    let formatted = "[Swift#\(index)] \(swiftName) => \(Int(score * 100.0))"
    return formatted.withCString { cStr in
        let len = min(strlen(cStr), max(0, maxCap - 1))
        if len > 0 {
            memcpy(outBuf, cStr, len)
        }
        outBuf[len] = 0
        return Int32(len)
    }
}

// ============================================================================
// APPLES-TO-APPLES (TSC): DIRECT NATIVESCRIPT -> SWIFT CALLING BRIDGE
// ============================================================================
@objc(NSSwiftBenchmarkBridge)
@objcMembers
public final class NSSwiftBenchmarkBridge: NSObject {
    @objc(addNumbers:b:)
    public static func addNumbers(_ a: Double, b: Double) -> Double {
        return a + b
    }

    @objc(formatSwiftRecord:score:index:)
    public static func formatSwiftRecord(_ name: String, score: Double, index: Int) -> String {
        return "[Swift#\(index)] \(name) => \(Int(score * 100.0))"
    }

    @objc(sha256SwiftString:)
    public static func sha256SwiftString(_ input: String) -> String {
        let data = Data(input.utf8)
        let digest = SHA256.hash(data: data)
        var out = [CChar](repeating: 0, count: 65)
        writeDigestHex(digest, to: &out)
        return String(cString: out)
    }

    @objc(stepParticlesSwiftPointer:floatCount:dt:steps:)
    public static func stepParticlesSwiftPointer(
        _ bufferPtr: UnsafeMutableRawPointer,
        floatCount: Int,
        dt: Float,
        steps: Int
    ) -> Double {
        let fPtr = bufferPtr.assumingMemoryBound(to: Float.self)
        let simulator = SwiftParticleSystem(
            attractor: SIMD4<Float>(0.5, -0.25, 0.75, 1.0),
            damping: 0.999
        )
        return simulator.stepInPlace(buffer: fPtr, floatCount: floatCount, dt: dt, steps: steps)
    }
}
