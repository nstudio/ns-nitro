import { iOS, Android, type HybridObject } from 'nitro-core';

/** Engine state at one instant of the flyby, matching what the synthesizer is playing. */
export interface EngineTelemetry {
  rpm: number;
  boostBar: number;
  throttle: number;
  wastegateFlutter: number;
  doppler: number;
}

/**
 * A Group B Audi Quattro S1 flyby synthesizer, written once in C++ and shared by iOS and Android.
 */
@iOS({
  language: 'c++',
  implementation: { className: 'HybridQuattroEngine', include: '"HybridQuattroEngine.hpp"' },
})
@Android({
  language: 'c++',
  implementation: { className: 'HybridQuattroEngine', include: '"HybridQuattroEngine.hpp"' },
})
export declare class QuattroEngine extends HybridObject {
  constructor(sampleRate: number);

  /** Inline-5 firing order: 1-2-4-5-3. */
  static readonly firingOrder: number[];
  static readonly cylinders: number;

  readonly sampleRate: number;
  /** Length of one flyby in seconds. */
  readonly flybyDuration: number;

  /**
   * Synthesizes a stereo, interleaved Float32 flyby on a native thread and resolves with a
   * native-owned ArrayBuffer, handed to JS without a copy.
   */
  synthesizeFlyby(seed: number): Promise<ArrayBuffer>;

  /**
   * Synthesizes one channel of the flyby straight into `output` (Float32 samples), which may be
   * memory owned by the platform, like an AVAudioPCMBuffer channel or a direct ByteBuffer.
   * `channel` 0 is left and 1 is right; `stride` is the distance between samples in floats.
   */
  renderInto(output: ArrayBuffer, seed: number, channel: number, stride: number): number;

  /** Engine state `seconds` into the flyby. */
  telemetryAt(seconds: number): EngineTelemetry;
}
export * from '#nitro/QuattroEngine';
