/**
 * Nitrogen-compatible HybridObject specification & runtime types for NativeScript iOS JSI.
 */

export interface HybridObject {
  readonly name: string;
  readonly instanceId: number;
  readonly memorySize: number;
  readonly isDisposed: boolean;
  dispose(): void;
  toString(): string;
}

export interface AudioDSPResult {
  peak: number;
  rms: number;
  samplesProcessed: number;
  bufferAddress: string;
}

export interface AsyncPiResult {
  pi: number;
  durationMs: number;
  iterations: number;
  dispatcher: string;
}

/**
 * Angle #1: C++20 JSI HybridObject (HostObject with cached HostFunctions)
 */
export interface NitroCompute extends HybridObject {
  addNumbers(a: number, b: number): number;
  fibonacci(n: number): number;
  formatRecord(label: string, score: number, index: number): string;
  dotProductZeroCopy(a: ArrayBuffer, b: ArrayBuffer): number;
  processAudioDSPZeroCopy(buffer: ArrayBuffer, gain: number, drive: number): AudioDSPResult;
  allocateNativeMutableBuffer(byteLength: number): ArrayBuffer;
  computePiAsync(iterations: number): Promise<AsyncPiResult>;
}

export interface NativeStateSummary {
  instanceId: number;
  tag: string;
  memoryBytes: number;
  callCount: number;
  accumulator: number;
  isDisposed: boolean;
}

/**
 * Angle #1b: Modern Nitro Prototype + facebook::jsi::NativeState HybridObject
 */
export interface NitroPrototypeCompute {
  addNumbers(a: number, b: number): number;
  multiplyAccumulate(a: number, b: number, c: number): number;
  getStateSummary(): NativeStateSummary;
  dispose(): void;
}

export interface SimdParticleStepResult {
  totalEnergy: number;
  vDspRms: number;
  simdVectors: number;
  backingStoreAddress: string;
}

export interface SwiftTaskGroupResult {
  result: number;
  durationMs: number;
  tasks: number;
  totalIterations: number;
  concurrencyEngine: string;
}

/**
 * Angle #2: Pure Swift 6 HybridObject (CryptoKit + SIMD4 + Structured Concurrency, zero @objc)
 */
export interface SwiftEngine extends HybridObject {
  addNumbers(a: number, b: number): number;
  sha256(input: string): string;
  sha256ZeroCopyBuffer(buffer: ArrayBuffer): string;
  hmacSha256(message: string, key: string): string;
  formatSwiftString?(label: string, score: number, index: number): string;
  formatNSString?(label: string, score: number, index: number): string;
  stepParticlesSIMDZeroCopy(buffer: ArrayBuffer, dt: number, steps: number): SimdParticleStepResult;
  runSwiftTaskGroupAsync(tasks: number, iterationsPerTask: number): Promise<SwiftTaskGroupResult>;
}

export interface NitroRuntimeDiagnostics {
  runtimeDescription: string;
  v8Version: string;
  v8IsolateAddress: string;
  jsiRuntimeAddress: string;
  nativeStateSupported: boolean;
  zeroCopyArrayBufferSupported: boolean;
  swiftCxxDirectInterop: boolean;
  activeHybridObjects: number;
  disposedHybridObjects: number;
  activeNativeStates: number;
  disposedNativeStates: number;
  totalNativeBytesAllocated: number;
}

export interface NitroModulesGlobal {
  readonly version: string;
  readonly hostPlatform: string;
  createHybridObject<T = HybridObject>(name: string, tag?: string, memoryBytes?: number): T;
  getRegisteredModules(): string[];
  hasNativeState(obj: object): boolean;
  getRuntimeDiagnostics(): NitroRuntimeDiagnostics;
}

export interface BenchmarkLane {
  label: string;
  pathway: 'nitro-proto' | 'nitro-cpp' | 'nitro-swift' | 'objc-classic' | 'reference';
  durationMs: number;
  opsPerSec: string;
  nsPerCall: string;
  relativeWidthPercent: number;
  badgeText: string;
  accentClass: string;
  barColor: string;
}

export interface BenchmarkCard {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  iterationsLabel: string;
  speedupHeadline: string;
  speedupDetail: string;
  verificationNote: string;
  lanes: BenchmarkLane[];
  ranAt?: string;
}
