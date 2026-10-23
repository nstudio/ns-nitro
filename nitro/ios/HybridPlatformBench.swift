import CryptoKit
import Foundation
import NitroModules

final class HybridPlatformBench: HybridPlatformBenchSpec {
  required override init() throws {
    try super.init()
  }

  static func addStatic(a: Double, b: Double) throws -> Double {
    return a + b
  }

  func add(a: Double, b: Double) throws -> Double {
    return a + b
  }

  func formatRecord(label: String, score: Double, index: Double) throws -> String {
    return "[Swift#\(Int(index))] \(label) => \(Int(score * 100.0))"
  }

  func sha256(data: ArrayBuffer) throws -> String {
    return data.withUnsafeBytes { bytes in
      hex(SHA256.hash(data: bytes))
    }
  }

  func sha256String(input: String) throws -> String {
    var input = input
    return input.withUTF8 { bytes in
      hex(SHA256.hash(data: UnsafeRawBufferPointer(bytes)))
    }
  }
}

private let hexDigits = Array("0123456789abcdef".utf8)

private func hex(_ digest: SHA256.Digest) -> String {
  var out = [UInt8](repeating: 0, count: SHA256.Digest.byteCount * 2)
  var i = 0
  for byte in digest {
    out[i] = hexDigits[Int(byte >> 4)]
    out[i + 1] = hexDigits[Int(byte & 0x0f)]
    i += 2
  }
  return String(decoding: out, as: UTF8.self)
}
