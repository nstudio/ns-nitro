import { iOS, Android, type HybridObject } from 'nitro-core';

export interface DspResult {
  peak: number;
  rms: number;
}

/**
 * Benchmark workloads implemented in C++, shared by iOS and Android.
 */
@iOS({
  language: 'c++',
  implementation: { className: 'HybridCxxBench', include: '"HybridCxxBench.hpp"' },
})
@Android({
  language: 'c++',
  implementation: { className: 'HybridCxxBench', include: '"HybridCxxBench.hpp"' },
})
export declare class CxxBench extends HybridObject {
  constructor(tag: string);

  static addStatic(a: number, b: number): number;

  readonly tag: string;
  add(a: number, b: number): number;
  formatRecord(label: string, score: number, index: number): string;
  /** Soft-clips and low-passes Float32 samples in place. */
  processDsp(samples: ArrayBuffer, gain: number, drive: number): DspResult;
}
export * from '#nitro/CxxBench';

/**
 * The same workloads in each platform's own language: Swift on iOS, Kotlin on Android.
 */
@iOS({ language: 'swift', implementation: { className: 'HybridPlatformBench' } })
@Android({ language: 'kotlin', implementation: { className: 'HybridPlatformBench' } })
export declare class PlatformBench extends HybridObject {
  constructor();

  static addStatic(a: number, b: number): number;

  add(a: number, b: number): number;
  formatRecord(label: string, score: number, index: number): string;
  /** Lowercase hex SHA-256 of the buffer's bytes (CryptoKit on iOS, MessageDigest on Android). */
  sha256(data: ArrayBuffer): string;
  /** Lowercase hex SHA-256 of the string's UTF-8 bytes. */
  sha256String(input: string): string;
}
export * from '#nitro/PlatformBench';
