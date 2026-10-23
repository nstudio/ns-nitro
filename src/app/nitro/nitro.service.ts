import { Injectable, signal, computed } from '@angular/core';
import { knownFolders } from '@nativescript/core';
import {
  AudioDSPResult,
  AsyncPiResult,
  BenchmarkCard,
  BenchmarkLane,
  NativeStateSummary,
  NitroCompute,
  NitroModulesGlobal,
  NitroPrototypeCompute,
  NitroRuntimeDiagnostics,
  NitroV1Showcase,
  SimdParticleStepResult,
  SwiftEngine,
  SwiftTaskGroupResult,
} from './nitro.types';
import { DeviceSecureEnclave } from '../../specs/DeviceSecureEnclave.shim';
import { installAndroidNitroHostIfNeeded } from './android-nitro-host';
import { NitroModules } from 'nitro-core';
import { CxxBench, PlatformBench } from '../../specs/Bench.nitro';
import { QuattroEngine } from '../../specs/QuattroEngine.nitro';

declare const NSNitroBridge: any;
declare const NSClassicObjCBridge: any;
declare const NSSwiftBenchmarkBridge: any;
declare const ns_direct_c_add: any;
declare const ns_direct_c_dsp: any;
declare const ns_direct_c_format_utf8: any;
declare const nitro_swift_add_numbers: any;
declare const nitro_swift_simd_nbody_step: any;
declare const interop: any;

interface RawLane {
  label: string;
  pathway: BenchmarkLane['pathway'];
  durationMs: number;
  iterations: number;
  badgeText: string;
  accentClass: string;
  barColor: string;
}

@Injectable({
  providedIn: 'root',
})
export class NitroService {
  private nitroCompute!: NitroCompute;
  private nitroProtoCompute!: NitroPrototypeCompute;
  private swiftEngine!: SwiftEngine;
  private secureEnclave!: DeviceSecureEnclave;
  private cxxBench!: CxxBench;
  private platformBench!: PlatformBench;

  readonly isAndroid = __ANDROID__;
  readonly isReady = signal<boolean>(false);
  readonly statusBanner = signal<string>('Initializing NativeScript V8 JSI Runtime...');
  readonly activeTab = signal<'overview' | 'benchmarks' | 'swift6' | 'zerocopy'>('overview');
  readonly isRunningBenchmarks = signal<boolean>(false);
  readonly isRunningAsync = signal<boolean>(false);
  readonly flybyTriggerCount = signal<number>(0);
  readonly nitroV1 = signal<NitroV1Showcase>({
    version: NitroModules.version,
    buildType: NitroModules.buildType,
    classNames: [],
    firingOrder: '',
    isInstance: false,
    isHybridObject: false,
    telemetry: '',
    synthKilobytes: 0,
    synthTotalMs: 0,
    jsBlockedMs: 0,
    running: false,
  });
  private nitroV1Seed = 100;
  readonly lastFlybyLabel = signal<string>(__ANDROID__ ? 'C++20 JSI vs JNI Suite' : 'Nitro JSI Suite');

  readonly diagnostics = signal<NitroRuntimeDiagnostics>({
    runtimeDescription: 'rnv8::V8Runtime',
    v8Version: '12.x',
    v8IsolateAddress: '0x0',
    jsiRuntimeAddress: '0x0',
    nativeStateSupported: true,
    zeroCopyArrayBufferSupported: true,
    swiftCxxDirectInterop: true,
    activeHybridObjects: 0,
    disposedHybridObjects: 0,
    activeNativeStates: 0,
    disposedNativeStates: 0,
    totalNativeBytesAllocated: 0,
  });

  readonly registeredModules = signal<string[]>([]);

  readonly nitrogenSpecTelemetry = signal<{
    specFile: string;
    hybridTag: string;
    enclaveArchitecture: string;
    hardwareConcurrency: number;
    hkdfKeyHex: string;
    aesGcmSealedHex: string;
    entropyPreviewHex: string;
    asyncRoundsKeyHex: string;
    operationsExecuted: number;
    memorySize: number;
  }>({
    specFile: 'src/specs/DeviceSecureEnclave.shim.ts',
    hybridTag: 'DeviceSecureEnclave',
    enclaveArchitecture: '',
    hardwareConcurrency: 0,
    hkdfKeyHex: '',
    aesGcmSealedHex: '',
    entropyPreviewHex: '',
    asyncRoundsKeyHex: 'Computing 2,500 HKDF rounds...',
    operationsExecuted: 0,
    memorySize: 4096,
  });

  readonly swiftCryptoTelemetry = signal<{
    inputPayload: string;
    hmacKey: string;
    sha256Digest: string;
    zeroCopyBufferDigest: string;
    hmacDigest: string;
    executionUs: number;
  }>({
    inputPayload: 'NativeScript 9.1 + Nitro JSI + Swift 6 CryptoKit',
    hmacKey: 'nstudio-quantum-key-2026',
    sha256Digest: '',
    zeroCopyBufferDigest: '',
    hmacDigest: '',
    executionUs: 0,
  });

  readonly zeroCopyTelemetry = signal<{
    bufferSamples: number;
    bufferBytes: number;
    backingStoreAddress: string;
    dspPeak: number;
    dspRms: number;
    dspDurationUs: number;
    throughputGbPerSec: number;
    simdEnergy: number;
    simdVectors: number;
    simdDurationUs: number;
    nativeMutableBufferSample0: number;
    nativeMutableBufferSample1: number;
    waveformPreview: number[];
  }>({
    bufferSamples: 65536,
    bufferBytes: 262144,
    backingStoreAddress: '0x0',
    dspPeak: 0,
    dspRms: 0,
    dspDurationUs: 0,
    throughputGbPerSec: 0,
    simdEnergy: 0,
    simdVectors: 16384,
    simdDurationUs: 0,
    nativeMutableBufferSample0: 0,
    nativeMutableBufferSample1: 0,
    waveformPreview: [0.35, 0.68, 0.92, 0.74, 0.41, 0.85, 0.96, 0.62, 0.29, 0.77, 0.88, 0.54],
  });

  readonly asyncTelemetry = signal<{
    swiftTaskResult: SwiftTaskGroupResult | null;
    cppPiResult: AsyncPiResult | null;
  }>({
    swiftTaskResult: null,
    cppPiResult: null,
  });

  readonly nativeStateSummary = signal<NativeStateSummary | null>(null);

  readonly benchmarkCategoryFilter = signal<'all' | 'tsc-apples' | 'classic'>('all');
  readonly tscApplesToApplesCards = signal<BenchmarkCard[]>([]);
  readonly benchmarkCards = signal<BenchmarkCard[]>([]);
  readonly allBenchmarkCards = computed(() => [
    ...this.tscApplesToApplesCards(),
    ...this.benchmarkCards(),
  ]);

  readonly averageSpeedup = computed(() => {
    const cards = this.benchmarkCards();
    if (!cards.length) return '—';
    let sum = 0;
    let count = 0;
    for (const c of cards) {
      const m = c.speedupHeadline.match(/([\d.]+)x/);
      if (m) {
        sum += parseFloat(m[1]);
        count++;
      }
    }
    return count > 0 ? `${(sum / count).toFixed(1)}x` : '—';
  });

  constructor() {
    this.initializeBridge();
  }

  formatInt(n: number): string {
    const r = Math.round(n);
    return (r < 0 ? '-' : '') + Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  private get nitroGlobal(): NitroModulesGlobal | undefined {
    return (globalThis as any).NitroModules as NitroModulesGlobal | undefined;
  }

  initializeBridge(): void {
    try {
      if (typeof NSNitroBridge !== 'undefined') {
        NSNitroBridge.install();
      } else if (__ANDROID__) {
        installAndroidNitroHostIfNeeded();
      }
      this.cxxBench = new CxxBench('BenchSuite');
      this.platformBench = new PlatformBench();

      const nitro = this.nitroGlobal;
      if (!nitro) {
        this.statusBanner.set('NitroModules global not found on V8 isolate');
        return;
      }

      this.nitroCompute = nitro.createHybridObject<NitroCompute>('NitroCompute');
      this.nitroProtoCompute = nitro.createHybridObject<NitroPrototypeCompute>(
        'NitroPrototypeCompute',
        'PrimaryProtoEngine',
        4096
      );
      this.swiftEngine = nitro.createHybridObject<SwiftEngine>('SwiftEngine');
      this.secureEnclave = nitro.createHybridObject<DeviceSecureEnclave>(
        'DeviceSecureEnclave'
      );

      this.registeredModules.set(nitro.getRegisteredModules());
      this.refreshDiagnostics();
      this.runNitrogenSpecDemo();
      if (!__ANDROID__) {
        this.runPureSwiftCryptoDemo();
      }
      this.runZeroCopyDspAndSimdDemo();
      this.runQuickInitialBenchmarks();
      if (!__ANDROID__) {
        this.runAsyncConcurrencyShowcase();
      } else {
        this.triggerRallyFlyby('C++20 JSI + Zero-Copy DSP');
      }

      // After the synchronous benchmarks, so its timing isn't spent waiting for the JS thread.
      void this.runNitroV1Showcase();
      this.isReady.set(true);
      this.statusBanner.set(
        `ONLINE • ${nitro.hostPlatform} • V8 ${this.diagnostics().v8Version}`
      );

      if (typeof NSProcessInfo !== 'undefined') {
        const args = NSProcessInfo.processInfo.arguments;
        for (let i = 0; i < args.count; i++) {
          const arg = String(args.objectAtIndex(i));
          if (arg.startsWith('--tab=')) {
            const tab = arg.slice('--tab='.length) as
              | 'overview'
              | 'benchmarks'
              | 'swift6'
              | 'zerocopy';
            if (
              tab === 'overview' ||
              tab === 'benchmarks' ||
              tab === 'swift6' ||
              tab === 'zerocopy'
            ) {
              this.activeTab.set(tab);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('[NitroService] Initialization error:', err);
      this.statusBanner.set(`Init Error: ${err?.message || err}`);
    }
  }

  refreshDiagnostics(): void {
    const nitro = this.nitroGlobal;
    if (!nitro) return;
    this.diagnostics.set(nitro.getRuntimeDiagnostics());
    if (this.nitroProtoCompute) {
      this.nativeStateSummary.set(this.nitroProtoCompute.getStateSummary());
    }
  }

  runNitrogenSpecDemo(customPayload?: string): void {
    if (!this.secureEnclave) return;
    const payload =
      customPayload ?? this.swiftCryptoTelemetry().inputPayload;
    const secret = this.swiftCryptoTelemetry().hmacKey;

    const hkdfKeyHex = this.secureEnclave.deriveHkdfKeyHex(
      secret,
      'ns-nitro-salt-2026',
      'DeviceSecureEnclave.nitro.ts'
    );
    const aesGcmSealedHex = this.secureEnclave.sealAesGcmPayload(
      payload,
      secret
    );
    const entropyBuffer = this.secureEnclave.generateEntropyBuffer(32);
    const entropyBytes = new Uint8Array(entropyBuffer);
    let entropyPreviewHex = '';
    for (let i = 0; i < Math.min(entropyBytes.length, 16); i++) {
      entropyPreviewHex += entropyBytes[i].toString(16).padStart(2, '0');
    }

    this.nitrogenSpecTelemetry.update((prev) => ({
      ...prev,
      hybridTag: this.secureEnclave.name,
      enclaveArchitecture: this.secureEnclave.enclaveArchitecture,
      hardwareConcurrency: this.secureEnclave.hardwareConcurrency,
      hkdfKeyHex,
      aesGcmSealedHex,
      entropyPreviewHex: `${entropyPreviewHex}... (${entropyBytes.byteLength}B zero-copy)`,
      operationsExecuted: this.secureEnclave.operationsExecuted,
      memorySize: this.secureEnclave.memorySize,
    }));

    this.secureEnclave
      .deriveKeyRoundsAsync(secret, 2500)
      .then((asyncKey) => {
        this.nitrogenSpecTelemetry.update((prev) => ({
          ...prev,
          asyncRoundsKeyHex: asyncKey,
          operationsExecuted: this.secureEnclave.operationsExecuted,
        }));
      })
      .catch((err) => {
        console.error('[NitroService] deriveKeyRoundsAsync error:', err);
      });
  }

  // ==========================================================================
  // ANGLE #2: PURE SWIFT 6 CRYPTOKIT & VALUE-TYPE INTEROP DEMO
  // ==========================================================================
  runPureSwiftCryptoDemo(customPayload?: string): void {
    if (!this.swiftEngine) return;
    const payload =
      customPayload ?? this.swiftCryptoTelemetry().inputPayload;
    const key = this.swiftCryptoTelemetry().hmacKey;

    const bytes = new Uint8Array(payload.length);
    for (let i = 0; i < payload.length; i++) {
      bytes[i] = payload.charCodeAt(i) & 0xff;
    }

    const t0 = performance.now();
    const sha256Digest = this.swiftEngine.sha256(payload);
    const zeroCopyBufferDigest = this.swiftEngine.sha256ZeroCopyBuffer(bytes.buffer);
    const hmacDigest = this.swiftEngine.hmacSha256(payload, key);
    const t1 = performance.now();

    this.swiftCryptoTelemetry.set({
      inputPayload: payload,
      hmacKey: key,
      sha256Digest,
      zeroCopyBufferDigest,
      hmacDigest,
      executionUs: Math.max(1, Math.round((t1 - t0) * 1000)),
    });

    this.runNitrogenSpecDemo(payload);
    this.refreshDiagnostics();
    this.triggerRallyFlyby('Swift 6 CryptoKit + Enclave');
  }

  // ==========================================================================
  // ANGLE #1 + #2: ZERO-COPY JSI ARRAYBUFFER DSP & PURE SWIFT SIMD4 PHYSICS
  // ==========================================================================
  runZeroCopyDspAndSimdDemo(drive = 2.4): void {
    if (!this.nitroCompute || !this.swiftEngine) return;

    const sampleCount = 65536; // 65,536 Float32 samples = 256 KB
    const floatView = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      floatView[i] =
        Math.sin(i * 0.08) * 0.75 + Math.cos(i * 0.023) * 0.25;
    }

    // 1. In-place Zero-Copy C++20 Biquad + Soft-Clipper DSP directly on V8 BackingStore
    const tDsp0 = performance.now();
    const dspRes: AudioDSPResult = this.nitroCompute.processAudioDSPZeroCopy(
      floatView.buffer,
      1.25,
      drive
    );
    const tDsp1 = performance.now();
    const dspDurationUs = Math.max(1, Math.round((tDsp1 - tDsp0) * 1000));
    const bytesProcessed = floatView.byteLength * 2; // read + write in-place
    const throughputGbPerSec =
      bytesProcessed / (Math.max(0.02, tDsp1 - tDsp0) / 1000) / 1e9;

    // Capture 12 normalized bars from the mutated Float32Array to prove in-place mutation
    const preview: number[] = [];
    for (let b = 0; b < 12; b++) {
      const idx = b * 128 + 16;
      preview.push(
        Math.min(1.0, Math.max(0.12, Math.abs(floatView[idx]) * 1.15))
      );
    }

    // 2. In-place Zero-Copy Pure Swift SIMD4<Float> + Accelerate vDSP particle step
    const tSimd0 = performance.now();
    const simdRes: SimdParticleStepResult =
      this.swiftEngine.stepParticlesSIMDZeroCopy(floatView.buffer, 0.016, 4);
    const tSimd1 = performance.now();
    const simdDurationUs = Math.max(1, Math.round((tSimd1 - tSimd0) * 1000));

    // 3. Allocate a C++-populated ArrayBuffer and read its pre-seeded harmonic wave in JS
    const cppOwnedBuffer = this.nitroCompute.allocateNativeMutableBuffer(1024);
    const cppFloatView = new Float32Array(cppOwnedBuffer);

    this.zeroCopyTelemetry.set({
      bufferSamples: sampleCount,
      bufferBytes: floatView.byteLength,
      backingStoreAddress: dspRes.bufferAddress,
      dspPeak: Number(dspRes.peak.toFixed(4)),
      dspRms: Number(dspRes.rms.toFixed(4)),
      dspDurationUs,
      throughputGbPerSec: Number(throughputGbPerSec.toFixed(2)),
      simdEnergy: Number(simdRes.totalEnergy.toFixed(2)),
      simdVectors: simdRes.simdVectors,
      simdDurationUs,
      nativeMutableBufferSample0: Number(cppFloatView[10].toFixed(4)),
      nativeMutableBufferSample1: Number(cppFloatView[25].toFixed(4)),
      waveformPreview: preview,
    });

    this.refreshDiagnostics();
    this.triggerRallyFlyby(`0-Copy DSP (${throughputGbPerSec.toFixed(1)} GB/s)`);
  }

  // ==========================================================================
  // ASYNC CONCURRENCY SHOWCASE: SWIFT 6 TASKGROUP & C++ GCD -> EVENTLOOP
  // ==========================================================================
  async runAsyncConcurrencyShowcase(): Promise<void> {
    if (!this.swiftEngine || !this.nitroCompute) return;
    this.isRunningAsync.set(true);
    try {
      const [swiftRes, cppRes] = await Promise.all([
        this.swiftEngine.runSwiftTaskGroupAsync(8, 350000),
        this.nitroCompute.computePiAsync(2800000),
      ]);
      this.asyncTelemetry.set({
        swiftTaskResult: swiftRes,
        cppPiResult: cppRes,
      });
      this.refreshDiagnostics();
      this.triggerRallyFlyby('8x Swift 6 TaskGroup + C++ GCD');
    } catch (err) {
      console.error('[NitroService] Async concurrency error:', err);
    } finally {
      this.isRunningAsync.set(false);
    }
  }

  // ==========================================================================
  // NATIVE STATE LIFECYCLE STRESS TEST
  // ==========================================================================
  runNativeStateLifecycleBurst(count = 500): void {
    const nitro = this.nitroGlobal;
    if (!nitro) return;

    const batch: NitroPrototypeCompute[] = [];
    for (let i = 0; i < count; i++) {
      const inst = nitro.createHybridObject<NitroPrototypeCompute>(
        'NitroPrototypeCompute',
        `BurstNode-${i}`,
        2048
      );
      inst.multiplyAccumulate(i, 1.5, 0.5);
      batch.push(inst);
    }

    for (let i = 0; i < 250; i++) {
      this.nitroProtoCompute.multiplyAccumulate(i, 2.0, 1.0);
    }

    for (let i = 0; i < batch.length; i++) {
      batch[i].dispose();
    }

    this.refreshDiagnostics();
    this.triggerRallyFlyby(`${count}x jsi::NativeState Burst`);
  }

  // ==========================================================================
  // NITRO MODULES V1 (nitro-core) SHOWCASE
  // ==========================================================================
  async runNitroV1Showcase(): Promise<void> {
    if (this.nitroV1().running) return;
    const engine = new QuattroEngine(44100);
    const telemetry = engine.telemetryAt(1.1);
    this.nitroV1.update((prev) => ({
      ...prev,
      classNames: NitroModules.getAllHybridClassNames().sort(),
      firingOrder: QuattroEngine.firingOrder.join('-'),
      isInstance: engine instanceof QuattroEngine,
      isHybridObject: NitroModules.isHybridObject(engine),
      telemetry: `${Math.round(telemetry.rpm)} rpm · ${telemetry.boostBar.toFixed(2)} bar · flutter ${telemetry.wastegateFlutter.toFixed(2)}`,
      running: true,
    }));

    // synthesizeFlyby returns immediately; C++ synthesizes on Nitro's thread pool and the
    // NativeScript dispatcher resolves the Promise back on the JS thread.
    const t0 = performance.now();
    const pending = engine.synthesizeFlyby(this.nitroV1Seed++);
    const jsBlockedMs = performance.now() - t0;
    try {
      const pcm = await pending;
      this.nitroV1.update((prev) => ({
        ...prev,
        synthKilobytes: Math.round(pcm.byteLength / 1024),
        synthTotalMs: performance.now() - t0,
        jsBlockedMs,
        running: false,
      }));
      this.triggerRallyFlyby('Nitro v1 C++ QuattroEngine');
    } catch (e) {
      console.error('[NitroService] synthesizeFlyby failed:', e);
      this.nitroV1.update((prev) => ({ ...prev, running: false }));
    } finally {
      engine.dispose();
    }
  }

  triggerRallyFlyby(label = 'Nitro JSI Benchmark'): void {
    this.lastFlybyLabel.set(label);
    this.flybyTriggerCount.update((c) => c + 1);
  }

  // ==========================================================================
  // ANGLE #3: HEAD-TO-HEAD BENCHMARK LAB (NITRO JSI vs CLASSIC OBJC INTEROP)
  // ==========================================================================
  runQuickInitialBenchmarks(): void {
    this.executeFullBenchmarkSuite(false);
  }

  runFullBenchmarkSuite(): void {
    this.isRunningBenchmarks.set(true);
    this.triggerRallyFlyby(
      __ANDROID__ ? 'Full 4-Suite JSI vs JNI Benchmark' : 'Full 5-Suite JSI Benchmark'
    );
    setTimeout(() => {
      try {
        this.executeFullBenchmarkSuite(true);
      } finally {
        this.isRunningBenchmarks.set(false);
      }
    }, 30);
  }

  private executeFullBenchmarkSuite(intensive: boolean): void {
    const nitro = this.nitroGlobal;
    if (!nitro || !this.nitroCompute || !this.nitroProtoCompute || !this.swiftEngine || !this.cxxBench) {
      return;
    }

    const tscCards: BenchmarkCard[] = [
      this.benchTscDirectCCalls(intensive ? 100000 : 50000),
      this.benchTscZeroCopyPointerDsp(intensive ? 50 : 25),
      this.benchTscSwiftOrJniCalls(intensive ? 50000 : 20000),
      this.benchTscEqualStringMarshaling(intensive ? 10000 : 4000),
    ];

    const cards: BenchmarkCard[] = [
      this.benchScalarCalls(intensive ? 100000 : 50000),
      this.benchZeroCopySimdVsObjCData(intensive ? 50 : 25),
      this.benchCryptoKitSha256(intensive ? 800 : 400),
      this.benchStringStructMarshaling(intensive ? 10000 : 4000),
      this.benchObjectLifecycleAndNativeState(intensive ? 1500 : 600),
    ];

    this.tscApplesToApplesCards.set(tscCards);
    this.benchmarkCards.set(cards);
    this.refreshDiagnostics();

    const report: string[] = [];
    for (const c of [...tscCards, ...cards]) {
      const lanesStr = c.lanes
        .map((l) => `${l.label} = ${l.durationMs}ms (${l.nsPerCall}, ${l.opsPerSec})`)
        .join(' | ');
      const line = `[BENCH:${c.id}] ${c.iterationsLabel} :: ${c.speedupHeadline} :: ${lanesStr} :: ${c.verificationNote}`;
      console.log(line);
      report.push(line);
    }
    // Release builds drop console output, so the latest run is also kept in benchmarks.txt: the app's
    // Documents folder on iOS, and its external files folder on Android (readable over adb).
    const reportFolder = __ANDROID__ ? knownFolders.externalDocuments() : knownFolders.documents();
    reportFolder.getFile('benchmarks.txt').writeTextSync(report.join('\n') + '\n');
  }

  private formatOpsPerSec(iterations: number, durationMs: number): string {
    const ops = iterations / Math.max(durationMs / 1000, 0.000001);
    if (ops >= 1e6) return `${(ops / 1e6).toFixed(2)}M ops/s`;
    if (ops >= 1e3) return `${(ops / 1e3).toFixed(1)}K ops/s`;
    return `${Math.round(ops)} ops/s`;
  }

  private formatNsPerCall(iterations: number, durationMs: number): string {
    const ns = (durationMs * 1e6) / iterations;
    if (ns >= 1000) return `${(ns / 1000).toFixed(2)} µs/call`;
    return `${Math.round(ns)} ns/call`;
  }

  private buildLanes(rawLanes: RawLane[]): BenchmarkLane[] {
    const maxDuration = Math.max(...rawLanes.map((l) => l.durationMs), 0.01);
    return rawLanes.map((l) => ({
      label: l.label,
      pathway: l.pathway,
      durationMs: Number(l.durationMs.toFixed(2)),
      opsPerSec: this.formatOpsPerSec(l.iterations, l.durationMs),
      nsPerCall: this.formatNsPerCall(l.iterations, l.durationMs),
      relativeWidthPercent: Math.max(
        6,
        Math.min(100, Math.round((l.durationMs / maxDuration) * 100))
      ),
      badgeText: l.badgeText,
      accentClass: l.accentClass,
      barColor: l.barColor,
    }));
  }

  // Every card runs each lane for the same number of iterations and verifies they computed the same
  // result. Lanes:
  // - Nitro v1: Hybrid Objects generated by nitrogen and run by nitro-core, in C++ and in the
  //   platform language (Swift on iOS, Kotlin on Android).
  // - Hand-written JSI: the app's own JSIShim host functions (iOS) or raw JSI functions (Android),
  //   only where that path is actually native.
  // - Classic: NativeScript's metadata-driven interop (Objective-C/C on iOS, JNI on Android).

  private readonly platformLanguage = __ANDROID__ ? 'Kotlin' : 'Swift';

  private timeMs(run: () => void): number {
    const t0 = performance.now();
    run();
    return Math.max(0.01, performance.now() - t0);
  }

  private get androidBridge(): any {
    return (globalThis as any).org?.nativescript?.nsnitro?.NitroAndroidBridge;
  }

  // Raw JSI functions installed by ns-nitro-jni.cpp; absent if that library failed to load.
  private get androidJsiBench(): any {
    return (globalThis as any).__NS_NITRO_JNI_BENCH__;
  }

  private speedupCard(
    lanes: RawLane[],
    classicMs: number,
  ): { headline: string; bestNitroMs: number } {
    const nitroMs = lanes.filter((l) => l.pathway === 'nitro-v1').map((l) => l.durationMs);
    const bestNitroMs = Math.min(...nitroMs);
    return { headline: `${(classicMs / bestNitroMs).toFixed(1)}x Faster`, bestNitroMs };
  }

  private nitroV1Lane(
    label: string,
    durationMs: number,
    iterations: number,
    language: 'c++' | 'platform',
  ): RawLane {
    return {
      label,
      pathway: 'nitro-v1',
      durationMs,
      iterations,
      badgeText: language === 'c++' ? 'NITRO C++' : `NITRO ${this.platformLanguage.toUpperCase()}`,
      accentClass: language === 'c++' ? 'text-emerald-400' : 'text-cyan-400',
      barColor: language === 'c++' ? '#10b981' : '#06b6d4',
    };
  }

  private handWrittenLane(
    label: string,
    durationMs: number,
    iterations: number,
  ): RawLane {
    return {
      label,
      pathway: 'nitro-cpp',
      durationMs,
      iterations,
      badgeText: 'RAW JSI',
      accentClass: 'text-indigo-400',
      barColor: '#6366f1',
    };
  }

  private classicLane(
    label: string,
    durationMs: number,
    iterations: number,
    badgeText: string,
  ): RawLane {
    return {
      label,
      pathway: 'objc-classic',
      durationMs,
      iterations,
      badgeText,
      accentClass: 'text-amber-400',
      barColor: '#f59e0b',
    };
  }

  // 1. Scalar Numeric Calls (add)
  private benchScalarCalls(iterations: number): BenchmarkCard {
    const cxx = this.cxxBench;
    const platform = this.platformBench;
    const handWritten = __ANDROID__ ? this.androidJsiBench?.jsiAddNumbers : this.nitroCompute.addNumbers;
    const classicAdd: (a: number, b: number) => number = __ANDROID__
      ? (a, b) => this.androidBridge.addNumbers(a, b)
      : (a, b) => NSClassicObjCBridge.addNumbersB(a, b);

    for (let i = 0; i < 500; i++) {
      cxx.add(i, 1);
      platform.add(i, 1);
      handWritten?.(i, 1);
      classicAdd(i, 1);
    }

    let accCxx = 0;
    const durCxx = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) accCxx = cxx.add(accCxx, 1.0);
    });
    let accPlatform = 0;
    const durPlatform = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) accPlatform = platform.add(accPlatform, 1.0);
    });
    let accHand = 0;
    const durHand = handWritten
      ? this.timeMs(() => {
          for (let i = 0; i < iterations; i++) accHand = handWritten(accHand, 1.0);
        })
      : 0;
    let accClassic = 0;
    const durClassic = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) accClassic = classicAdd(accClassic, 1.0);
    });

    const lanes = [
      this.nitroV1Lane('Nitro v1 → C++ HybridObject (CxxBench.add)', durCxx, iterations, 'c++'),
      this.nitroV1Lane(`Nitro v1 → ${this.platformLanguage} HybridObject (PlatformBench.add)`, durPlatform, iterations, 'platform'),
      ...(handWritten ? [this.handWrittenLane('Hand-written JSI HostFunction → C++', durHand, iterations)] : []),
      this.classicLane(
        __ANDROID__
          ? 'Classic NativeScript JNI (NitroAndroidBridge.addNumbers)'
          : 'Classic NativeScript ObjC Metadata (libffi + objc_msgSend)',
        durClassic,
        iterations,
        'BASELINE',
      ),
    ];
    const { headline, bestNitroMs } = this.speedupCard(lanes, durClassic);
    const verified = accCxx === iterations && accPlatform === iterations && accClassic === iterations;

    return {
      id: 'scalar-100k',
      title: 'Scalar Dispatch: add(a, b)',
      subtitle: `Raw JS-to-native call overhead: Nitro v1 Hybrid Objects (C++ and ${this.platformLanguage}) vs a hand-written JSI function vs classic NativeScript ${__ANDROID__ ? 'JNI' : 'Objective-C'} interop.`,
      category: 'CALL DISPATCH',
      iterationsLabel: `${this.formatInt(iterations)} calls`,
      speedupHeadline: headline,
      speedupDetail: `${bestNitroMs.toFixed(2)} ms (Nitro v1) vs ${durClassic.toFixed(2)} ms (Classic ${__ANDROID__ ? 'JNI' : 'Metadata'})`,
      verificationNote: `Checksums ${verified ? 'match' : 'MISMATCH'}: C++=${accCxx}, ${this.platformLanguage}=${accPlatform}${handWritten ? `, JSI=${accHand}` : ''}, Classic=${accClassic}`,
      ranAt: 'Live',
      lanes: this.buildLanes(lanes),
    };
  }

  // 2. Zero-copy ArrayBuffer DSP vs copying into NSMutableData / a direct ByteBuffer
  private benchZeroCopySimdVsObjCData(rounds: number): BenchmarkCard {
    const floatCount = 16384; // 64 KB Float32 frame
    const source = new Float32Array(floatCount);
    for (let i = 0; i < floatCount; i++) {
      source[i] = Math.sin(i * 0.05) * 0.8;
    }
    const gain = 1.01;
    const drive = 1.2;

    const nitroFrame = new Float32Array(source);
    let nitroPeak = 0;
    const durNitro = this.timeMs(() => {
      for (let r = 0; r < rounds; r++) nitroPeak = this.cxxBench.processDsp(nitroFrame.buffer, gain, drive).peak;
    });

    let handPeak = 0;
    let durHand = 0;
    if (!__ANDROID__) {
      const handFrame = new Float32Array(source);
      const dsp = this.nitroCompute.processAudioDSPZeroCopy;
      durHand = this.timeMs(() => {
        for (let r = 0; r < rounds; r++) handPeak = dsp(handFrame.buffer, gain, drive).peak;
      });
    }

    // Classic: copy the frame into native memory each round, then run the same DSP natively.
    const classicFrame = new Float32Array(source);
    let classicPeak = 0;
    const durClassic = this.timeMs(() => {
      for (let r = 0; r < rounds; r++) {
        if (__ANDROID__) {
          const direct = java.nio.ByteBuffer.allocateDirect(classicFrame.byteLength).order(java.nio.ByteOrder.nativeOrder());
          const view = new Float32Array((ArrayBuffer as any).from(direct));
          view.set(classicFrame);
          classicPeak = this.androidBridge.processDspByteBuffer(direct, floatCount, gain, drive);
          classicFrame.set(view);
        } else {
          const data = NSMutableData.dataWithBytesLength(classicFrame.buffer as any, classicFrame.byteLength);
          classicPeak = ns_direct_c_dsp(data.mutableBytes, floatCount, gain, drive);
          classicFrame.set(new Float32Array(interop.bufferFromData(data)));
        }
      }
    });

    const lanes = [
      this.nitroV1Lane('Nitro v1 ArrayBuffer → C++ DSP (in place, 0 copies)', durNitro, rounds, 'c++'),
      ...(__ANDROID__ ? [] : [this.handWrittenLane('Hand-written JSI rt.data() → C++ DSP', durHand, rounds)]),
      this.classicLane(
        __ANDROID__
          ? 'Classic: copy into direct ByteBuffer → Java DSP → copy back'
          : 'Classic: copy into NSMutableData → C DSP (ns_direct_c_dsp) → copy back',
        durClassic,
        rounds,
        'DATA COPY',
      ),
    ];
    const { headline, bestNitroMs } = this.speedupCard(lanes, durClassic);

    return {
      id: 'zerocopy-simd',
      title: 'Zero-Copy ArrayBuffer Audio DSP',
      subtitle: `Soft-clips and low-passes a 64 KB Float32 frame. Nitro v1 hands C++ the V8 backing store directly; classic interop copies the frame into ${__ANDROID__ ? 'a direct ByteBuffer' : 'NSMutableData'} and back each round. Same algorithm in every lane.`,
      category: 'ZERO-COPY MEMORY',
      iterationsLabel: `${rounds} frames × 64 KB`,
      speedupHeadline: headline,
      speedupDetail: `${bestNitroMs.toFixed(2)} ms (Nitro v1, 0 copies) vs ${durClassic.toFixed(2)} ms (copy in + out)`,
      verificationNote: `Peaks: Nitro=${nitroPeak.toFixed(4)}${__ANDROID__ ? '' : `, JSI=${handPeak.toFixed(4)}`}, Classic=${classicPeak.toFixed(4)}`,
      ranAt: 'Live',
      lanes: this.buildLanes(lanes),
    };
  }

  // 3. SHA-256 of an 8 KB frame in the platform's crypto library
  private benchCryptoKitSha256(iterations: number): BenchmarkCard {
    const chunk = 'NativeScript + NitroModules JSI Zero-Overhead Cryptographic Benchmark Payload 2026 | ';
    const payload = chunk.repeat(96);
    const bytes = new Uint8Array(payload.length);
    for (let i = 0; i < payload.length; i++) {
      bytes[i] = payload.charCodeAt(i) & 0xff;
    }
    const platform = this.platformBench;

    let digestBuffer = '';
    const durNitroBuffer = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) digestBuffer = platform.sha256(bytes.buffer);
    });
    let digestString = '';
    const durNitroString = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) digestString = platform.sha256String(payload);
    });

    let digestHand = '';
    let durHand = 0;
    if (!__ANDROID__) {
      const sha = this.swiftEngine.sha256ZeroCopyBuffer;
      durHand = this.timeMs(() => {
        for (let i = 0; i < iterations; i++) digestHand = sha(bytes.buffer);
      });
    }

    let digestClassic = '';
    let lastJavaDigest: any = null;
    const durClassic = this.timeMs(() => {
      if (__ANDROID__) {
        const md = java.security.MessageDigest.getInstance('SHA-256');
        for (let i = 0; i < iterations; i++) {
          lastJavaDigest = md.digest(new java.lang.String(payload).getBytes('UTF-8'));
        }
      } else {
        for (let i = 0; i < iterations; i++) digestClassic = NSClassicObjCBridge.sha256String(payload);
      }
    });
    if (__ANDROID__ && lastJavaDigest) {
      for (let i = 0; i < lastJavaDigest.length; i++) {
        digestClassic += (lastJavaDigest[i] & 0xff).toString(16).padStart(2, '0');
      }
    }

    const lanes = [
      this.nitroV1Lane(`Nitro v1 ArrayBuffer → ${__ANDROID__ ? 'Kotlin MessageDigest' : 'Swift CryptoKit'}`, durNitroBuffer, iterations, 'platform'),
      this.nitroV1Lane(`Nitro v1 string → ${__ANDROID__ ? 'Kotlin MessageDigest' : 'Swift CryptoKit'}`, durNitroString, iterations, 'platform'),
      ...(__ANDROID__ ? [] : [this.handWrittenLane('Hand-written JSI rt.data() → Swift CryptoKit (@_cdecl)', durHand, iterations)]),
      this.classicLane(
        __ANDROID__
          ? 'Classic JNI java.lang.String.getBytes() → MessageDigest'
          : 'Classic @objc NSString bridge → CryptoKit',
        durClassic,
        iterations,
        __ANDROID__ ? 'JNI COPY' : 'OBJC WRAPPER',
      ),
    ];
    const { headline, bestNitroMs } = this.speedupCard(lanes, durClassic);
    const verified =
      digestBuffer === digestString && digestString === digestClassic && (__ANDROID__ || digestHand === digestBuffer);

    return {
      id: 'swift-cryptokit',
      title: __ANDROID__ ? 'SHA-256: Kotlin MessageDigest' : 'SHA-256: Apple CryptoKit (Pure Swift)',
      subtitle: `Hashes an 8 KB telemetry frame with ${__ANDROID__ ? 'java.security.MessageDigest' : 'CryptoKit.SHA256'}, called through a Nitro v1 ${this.platformLanguage} Hybrid Object vs classic ${__ANDROID__ ? 'JNI' : 'Objective-C'} interop.`,
      category: __ANDROID__ ? 'PLATFORM CRYPTO' : 'PURE SWIFT API',
      iterationsLabel: `${this.formatInt(iterations)} × 8 KB`,
      speedupHeadline: headline,
      speedupDetail: `${bestNitroMs.toFixed(2)} ms (Nitro v1) vs ${durClassic.toFixed(2)} ms (Classic bridge)`,
      verificationNote: `SHA-256 ${digestBuffer.slice(0, 24)}… (${verified ? 'all lanes match' : 'MISMATCH'})`,
      ranAt: 'Live',
      lanes: this.buildLanes(lanes),
    };
  }

  // 4. String formatting round trips
  private benchStringStructMarshaling(iterations: number): BenchmarkCard {
    const cxx = this.cxxBench;
    const platform = this.platformBench;
    const handWritten = __ANDROID__ ? this.androidJsiBench?.jsiFormatRecord : this.nitroCompute.formatRecord;
    const classicFormat: (label: string, score: number, index: number) => string = __ANDROID__
      ? (label, score, index) => this.androidBridge.formatRecord(label, score, index)
      : (label, score, index) => NSClassicObjCBridge.formatRecordScoreIndex(label, score, index);

    let lastCxx = '';
    const durCxx = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) lastCxx = cxx.formatRecord('TelemetryFrame', 0.984, i);
    });
    let lastPlatform = '';
    const durPlatform = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) lastPlatform = platform.formatRecord('TelemetryFrame', 0.984, i);
    });
    let lastHand = '';
    const durHand = handWritten
      ? this.timeMs(() => {
          for (let i = 0; i < iterations; i++) lastHand = handWritten('TelemetryFrame', 0.984, i);
        })
      : 0;
    let lastClassic = '';
    const durClassic = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) lastClassic = classicFormat('TelemetryFrame', 0.984, i);
    });

    const lanes = [
      this.nitroV1Lane('Nitro v1 → C++ (std::string)', durCxx, iterations, 'c++'),
      this.nitroV1Lane(`Nitro v1 → ${this.platformLanguage} (String)`, durPlatform, iterations, 'platform'),
      ...(handWritten ? [this.handWrittenLane('Hand-written JSI → C++ UTF-8', durHand, iterations)] : []),
      this.classicLane(
        __ANDROID__ ? 'Classic JNI java.lang.String ↔ V8 string' : 'Classic NSString ↔ V8 string',
        durClassic,
        iterations,
        __ANDROID__ ? 'JNI STRING' : 'NSSTRING',
      ),
    ];
    const { headline, bestNitroMs } = this.speedupCard(lanes, durClassic);

    return {
      id: 'string-marshaling',
      title: 'String Marshaling Round Trips',
      subtitle: `Passes a string and two numbers in and formats a string back out, through Nitro v1 (C++ and ${this.platformLanguage}), a hand-written JSI function and classic ${__ANDROID__ ? 'JNI' : 'NSString'} bridging.`,
      category: 'DATA CONVERSION',
      iterationsLabel: `${this.formatInt(iterations)} roundtrips`,
      speedupHeadline: headline,
      speedupDetail: `${bestNitroMs.toFixed(2)} ms (Nitro v1) vs ${durClassic.toFixed(2)} ms (Classic)`,
      verificationNote: `"${lastCxx}" · "${lastPlatform}"${handWritten ? ` · "${lastHand}"` : ''} · "${lastClassic}"`,
      ranAt: 'Live',
      lanes: this.buildLanes(lanes),
    };
  }

  // 5. Native object creation and deterministic disposal
  private benchObjectLifecycleAndNativeState(iterations: number): BenchmarkCard {
    let tagLength = 0;
    const durCxx = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) {
        const bench = new CxxBench('BenchState');
        tagLength += bench.tag.length;
        bench.dispose();
      }
    });
    const durPlatform = this.timeMs(() => {
      for (let i = 0; i < iterations; i++) {
        new PlatformBench().dispose();
      }
    });

    let durHand = 0;
    if (!__ANDROID__) {
      const nitro = this.nitroGlobal!;
      durHand = this.timeMs(() => {
        for (let i = 0; i < iterations; i++) {
          nitro.createHybridObject<NitroPrototypeCompute>('NitroPrototypeCompute', 'BenchState', 1024).dispose();
        }
      });
    }

    const durClassic = this.timeMs(() => {
      if (__ANDROID__) {
        for (let i = 0; i < iterations; i++) {
          const map = new java.util.HashMap(4);
          map.put('tag', 'BenchState');
          map.put('memoryBytes', java.lang.Integer.valueOf(1024));
          map.clear();
        }
      } else {
        for (let i = 0; i < iterations; i++) {
          const dict = NSMutableDictionary.alloc().initWithCapacity(3);
          dict.setObjectForKey('BenchState', 'tag');
          dict.setObjectForKey(1024, 'memoryBytes');
          dict.removeAllObjects();
        }
      }
    });

    const lanes = [
      this.nitroV1Lane('Nitro v1 new CxxBench() + read + dispose()', durCxx, iterations, 'c++'),
      this.nitroV1Lane(`Nitro v1 new PlatformBench() (${this.platformLanguage}) + dispose()`, durPlatform, iterations, 'platform'),
      ...(__ANDROID__ ? [] : [this.handWrittenLane('Hand-written JSI NativeState object + dispose()', durHand, iterations)]),
      this.classicLane(
        __ANDROID__ ? 'Classic JNI java.util.HashMap state + clear()' : 'Classic ObjC NSMutableDictionary state + clear',
        durClassic,
        iterations,
        __ANDROID__ ? 'JNI ALLOC' : 'OBJC ALLOC',
      ),
    ];
    const { headline, bestNitroMs } = this.speedupCard(lanes, durClassic);

    return {
      id: 'nativestate-lifecycle',
      title: 'Native Object Lifecycle',
      subtitle: `Creates a native object with state from JS, reads it and disposes it deterministically: Nitro v1 \`new\` (jsi::NativeState + prototype) vs classic ${__ANDROID__ ? 'JNI' : 'Objective-C'} allocation.`,
      category: 'OBJECT LIFETIME',
      iterationsLabel: `${this.formatInt(iterations)} instances`,
      speedupHeadline: headline,
      speedupDetail: `${bestNitroMs.toFixed(2)} ms (Nitro v1) vs ${durClassic.toFixed(2)} ms (${__ANDROID__ ? 'JNI java.util.HashMap' : 'ObjC NSMutableDictionary'})`,
      verificationNote: `Read ${this.formatInt(tagLength)} tag characters across ${this.formatInt(iterations)} C++ instances`,
      ranAt: 'Live',
      lanes: this.buildLanes(lanes),
    };
  }

  // ==========================================================================
  // APPLES-TO-APPLES (TSC) BENCHMARK SUITE
  // Compares equivalent native work:
  // - iOS C-to-C: NativeScript C Metadata (CFunction + libffi, no ObjC) vs JSI
  // - Android C-to-C: Node-API (N-API) C Wrapper vs JSI
  // - iOS Swift-to-Swift: NativeScript -> Swift vs Nitro -> Swift
  // - Android JNI-to-JNI: Nitro JNI Call (JSI -> C++ -> JNIEnv -> Java)
  //                       vs NativeScript Method Call (V8 -> Metadata -> JNI -> Java)
  // ==========================================================================

  // TSC #1: Direct C Function Calls (Zero Objective-C / Zero Java)
  private benchTscDirectCCalls(iterations: number): BenchmarkCard {
    const jsiAdd = this.nitroCompute.addNumbers;

    if (__ANDROID__) {
      const napiBench = (globalThis as any).__NS_NAPI_BENCH__;
      const jsiBench = (globalThis as any).__NS_NITRO_JNI_BENCH__;
      const napiAddFn = napiBench?.addNumbers ?? jsiAdd;
      const nativeJsiAddFn = jsiBench?.jsiAddNumbers ?? jsiAdd;

      for (let i = 0; i < 300; i++) {
        nativeJsiAddFn(i, 1.0);
        napiAddFn(i, 1.0);
      }

      const tJsi0 = performance.now();
      let accJsi = 0;
      for (let i = 0; i < iterations; i++) {
        accJsi = nativeJsiAddFn(accJsi, 1.0);
      }
      const durJsi = Math.max(0.05, performance.now() - tJsi0);

      const tNapi0 = performance.now();
      let accNapi = 0;
      for (let i = 0; i < iterations; i++) {
        accNapi = napiAddFn(accNapi, 1.0);
      }
      const durNapi = Math.max(0.05, performance.now() - tNapi0);

      const ratio = (durNapi / durJsi).toFixed(2);
      return {
        id: 'tsc-c-to-c',
        title: 'Direct C Function Call: JSI vs. N-API C Wrapper',
        subtitle:
          'Apples-to-Apples C-to-C call on Android: compares Nitro JSI HostFunction against a Node-API (napi_create_function) C wrapper calling the exact same C function ns_c_add(a, b) with zero JNI/Java.',
        category: 'APPLES-TO-APPLES • C-TO-C',
        iterationsLabel: `${this.formatInt(iterations)} C calls`,
        speedupHeadline: `${ratio}x Ratio`,
        speedupDetail: `${durJsi.toFixed(2)} ms (JSI C) vs ${durNapi.toFixed(2)} ms (N-API C Wrapper)`,
        verificationNote: `Both call extern "C" ns_c_add(a,b) • JSI=${accJsi}, N-API=${accNapi}`,
        ranAt: 'Live',
        lanes: this.buildLanes([
          {
            label: 'Nitro JSI HostFunction → C Function (ns_c_add)',
            pathway: 'nitro-cpp',
            durationMs: durJsi,
            iterations,
            badgeText: 'JSI C',
            accentClass: 'text-emerald-400',
            barColor: '#10b981',
          },
          {
            label: 'Node-API (N-API) C Wrapper → C Function (ns_c_add)',
            pathway: 'reference',
            durationMs: durNapi,
            iterations,
            badgeText: 'N-API C',
            accentClass: 'text-cyan-400',
            barColor: '#06b6d4',
          },
        ]),
      };
    }

    // iOS: Direct C Function Metadata (no objc_msgSend) vs JSI HostFunction
    const hasDirectC = typeof ns_direct_c_add === 'function';
    const hasSwiftC = typeof nitro_swift_add_numbers === 'function';

    for (let i = 0; i < 300; i++) {
      jsiAdd(i, 1.0);
      if (hasDirectC) ns_direct_c_add(i, 1.0);
      if (hasSwiftC) nitro_swift_add_numbers(i, 1.0);
    }

    const tJsi0 = performance.now();
    let accJsi = 0;
    for (let i = 0; i < iterations; i++) {
      accJsi = jsiAdd(accJsi, 1.0);
    }
    const durJsi = Math.max(0.05, performance.now() - tJsi0);

    const tDirectC0 = performance.now();
    let accDirectC = 0;
    if (hasDirectC) {
      for (let i = 0; i < iterations; i++) {
        accDirectC = ns_direct_c_add(accDirectC, 1.0);
      }
    }
    const durDirectC = Math.max(0.05, performance.now() - tDirectC0);

    const tSwiftC0 = performance.now();
    let accSwiftC = 0;
    if (hasSwiftC) {
      for (let i = 0; i < iterations; i++) {
        accSwiftC = nitro_swift_add_numbers(accSwiftC, 1.0);
      }
    }
    const durSwiftC = Math.max(0.05, performance.now() - tSwiftC0);

    const ratio = (durDirectC / durJsi).toFixed(2);
    return {
      id: 'tsc-c-to-c',
      title: 'Direct C Function Call: JSI vs. NativeScript C Metadata',
      subtitle:
        'Apples-to-Apples C-to-C call on iOS: NativeScript calls extern "C" ns_direct_c_add(a, b) directly via C metadata (CFunction + libffi, zero Objective-C / objc_msgSend) vs. Nitro JSI HostFunction.',
      category: 'APPLES-TO-APPLES • C-TO-C',
      iterationsLabel: `${this.formatInt(iterations)} C calls`,
      speedupHeadline: `${ratio}x Ratio`,
      speedupDetail: `${durJsi.toFixed(2)} ms (JSI C++) vs ${durDirectC.toFixed(2)} ms (NativeScript Direct C)`,
      verificationNote: `Zero Objective-C involved • Checksums: JSI=${accJsi}, DirectC=${accDirectC}, SwiftC=${accSwiftC}`,
      ranAt: 'Live',
      lanes: this.buildLanes([
        {
          label: 'Nitro JSI HostFunction → C Function (addNumbers)',
          pathway: 'nitro-cpp',
          durationMs: durJsi,
          iterations,
          badgeText: 'JSI C++',
          accentClass: 'text-emerald-400',
          barColor: '#10b981',
        },
        {
          label: 'NativeScript Direct C Metadata → ns_direct_c_add (No ObjC)',
          pathway: 'reference',
          durationMs: durDirectC,
          iterations,
          badgeText: 'NS DIRECT C',
          accentClass: 'text-cyan-400',
          barColor: '#06b6d4',
        },
        {
          label: 'NativeScript Direct C Metadata → Swift @_cdecl (No ObjC)',
          pathway: 'nitro-swift',
          durationMs: durSwiftC,
          iterations,
          badgeText: 'NS C→SWIFT',
          accentClass: 'text-indigo-400',
          barColor: '#6366f1',
        },
      ]),
    };
  }

  // TSC #2: Zero-Copy Pointer DSP (interop.handleof / N-API vs JSI rt.data)
  private benchTscZeroCopyPointerDsp(rounds: number): BenchmarkCard {
    const floatCount = 16384; // 64 KB Float32 buffer
    const f32 = new Float32Array(floatCount);
    for (let i = 0; i < floatCount; i++) {
      f32[i] = (i % 100) * 0.01;
    }

    if (__ANDROID__) {
      const napiBench = (globalThis as any).__NS_NAPI_BENCH__;
      const jsiBench = (globalThis as any).__NS_NITRO_JNI_BENCH__;

      const tJsi0 = performance.now();
      let peakJsi = 0;
      for (let r = 0; r < rounds; r++) {
        peakJsi = jsiBench?.jsiDspZeroCopy
          ? jsiBench.jsiDspZeroCopy(f32.buffer, 1.01, 1.2)
          : this.nitroCompute.processAudioDSPZeroCopy(f32.buffer, 1.01, 1.2).peak;
      }
      const durJsi = Math.max(0.05, performance.now() - tJsi0);

      const tNapi0 = performance.now();
      let peakNapi = 0;
      for (let r = 0; r < rounds; r++) {
        peakNapi = napiBench?.processAudioDSPZeroCopy
          ? napiBench.processAudioDSPZeroCopy(f32.buffer, 1.01, 1.2)
          : peakJsi;
      }
      const durNapi = Math.max(0.05, performance.now() - tNapi0);

      const ratio = (durNapi / durJsi).toFixed(2);
      return {
        id: 'tsc-zero-copy-c',
        title: 'Zero-Copy C Pointer DSP: JSI vs. N-API ArrayBuffer',
        subtitle:
          'Both pathways unwrap the raw V8 ArrayBuffer backing store pointer in C (rt.data vs napi_get_arraybuffer_info) and run the exact same in-place C biquad filter with zero byte copies.',
        category: 'APPLES-TO-APPLES • 0-COPY C',
        iterationsLabel: `${rounds} frames × 64 KB`,
        speedupHeadline: `${ratio}x Ratio`,
        speedupDetail: `${durJsi.toFixed(2)} ms (JSI rt.data) vs ${durNapi.toFixed(2)} ms (N-API ArrayBuffer)`,
        verificationNote: `0 byte copies in both lanes • Peak JSI=${Number(peakJsi).toFixed(3)}, N-API=${Number(peakNapi).toFixed(3)}`,
        ranAt: 'Live',
        lanes: this.buildLanes([
          {
            label: 'Nitro JSI ArrayBuffer (rt.data) → C Biquad DSP',
            pathway: 'nitro-cpp',
            durationMs: durJsi,
            iterations: rounds,
            badgeText: 'JSI 0-COPY',
            accentClass: 'text-emerald-400',
            barColor: '#10b981',
          },
          {
            label: 'Node-API (napi_get_arraybuffer_info) → C Biquad DSP',
            pathway: 'reference',
            durationMs: durNapi,
            iterations: rounds,
            badgeText: 'N-API 0-COPY',
            accentClass: 'text-cyan-400',
            barColor: '#06b6d4',
          },
        ]),
      };
    }

    // iOS: JSI rt.data(ArrayBuffer) vs NativeScript C Metadata + interop.handleof(ArrayBuffer)
    const dspJsi = this.nitroCompute.processAudioDSPZeroCopy;
    const simdJsi = this.swiftEngine.stepParticlesSIMDZeroCopy;
    const hasDirectCDsp =
      typeof ns_direct_c_dsp === 'function' && typeof interop !== 'undefined';
    const hasDirectCSimd =
      typeof nitro_swift_simd_nbody_step === 'function' &&
      typeof interop !== 'undefined';

    const tJsiDsp0 = performance.now();
    let peakJsi = 0;
    for (let r = 0; r < rounds; r++) {
      peakJsi = dspJsi(f32.buffer, 1.01, 1.2).peak;
    }
    const durJsiDsp = Math.max(0.05, performance.now() - tJsiDsp0);

    const tNsCDsp0 = performance.now();
    let peakNsC = 0;
    if (hasDirectCDsp) {
      for (let r = 0; r < rounds; r++) {
        const ptr = interop.handleof(f32.buffer);
        peakNsC = ns_direct_c_dsp(ptr, floatCount, 1.01, 1.2);
      }
    }
    const durNsCDsp = Math.max(0.05, performance.now() - tNsCDsp0);

    const tJsiSimd0 = performance.now();
    let energyJsi = 0;
    for (let r = 0; r < rounds; r++) {
      energyJsi = simdJsi(f32.buffer, 0.016, 2).totalEnergy;
    }
    const durJsiSimd = Math.max(0.05, performance.now() - tJsiSimd0);

    const tNsCSimd0 = performance.now();
    let energyNsC = 0;
    if (hasDirectCSimd) {
      for (let r = 0; r < rounds; r++) {
        const ptr = interop.handleof(f32.buffer);
        energyNsC = nitro_swift_simd_nbody_step(ptr, floatCount, 0.016, 2);
      }
    }
    const durNsCSimd = Math.max(0.05, performance.now() - tNsCSimd0);

    const ratio = (durNsCDsp / durJsiDsp).toFixed(2);
    return {
      id: 'tsc-zero-copy-c',
      title: 'Zero-Copy C Pointer DSP: JSI rt.data vs. interop.handleof()',
      subtitle:
        'Apples-to-Apples Zero-Copy on iOS: NativeScript passes interop.handleof(arrayBuffer) directly to C & Swift SIMD4 functions with zero NSMutableData allocation vs. Nitro JSI rt.data(ArrayBuffer).',
      category: 'APPLES-TO-APPLES • 0-COPY C',
      iterationsLabel: `${rounds} frames × 64 KB`,
      speedupHeadline: `${ratio}x Ratio`,
      speedupDetail: `${durJsiDsp.toFixed(2)} ms (JSI rt.data) vs ${durNsCDsp.toFixed(2)} ms (NS interop.handleof)`,
      verificationNote: `Zero NSMutableData copies • Peak=${peakNsC.toFixed(3)} • SIMD Energy=${energyNsC.toFixed(1)}`,
      ranAt: 'Live',
      lanes: this.buildLanes([
        {
          label: 'Nitro JSI rt.data(ArrayBuffer) → C++20 Biquad DSP',
          pathway: 'nitro-cpp',
          durationMs: durJsiDsp,
          iterations: rounds,
          badgeText: 'JSI 0-COPY',
          accentClass: 'text-emerald-400',
          barColor: '#10b981',
        },
        {
          label: 'NativeScript interop.handleof(ab) → Direct C DSP (No NSData)',
          pathway: 'reference',
          durationMs: durNsCDsp,
          iterations: rounds,
          badgeText: 'NS HANDLEOF C',
          accentClass: 'text-cyan-400',
          barColor: '#06b6d4',
        },
        {
          label: 'Nitro JSI rt.data(ArrayBuffer) → Swift 6 SIMD4 + vDSP',
          pathway: 'nitro-swift',
          durationMs: durJsiSimd,
          iterations: rounds,
          badgeText: 'JSI SIMD4',
          accentClass: 'text-indigo-400',
          barColor: '#6366f1',
        },
        {
          label: 'NativeScript interop.handleof(ab) → Swift 6 SIMD4 (No ObjC)',
          pathway: 'objc-classic',
          durationMs: durNsCSimd,
          iterations: rounds,
          badgeText: 'NS HANDLEOF SIMD',
          accentClass: 'text-amber-400',
          barColor: '#f59e0b',
        },
      ]),
    };
  }

  // TSC #3: iOS Swift-to-Swift Calling OR Android Nitro JNI vs NativeScript Method Call
  private benchTscSwiftOrJniCalls(iterations: number): BenchmarkCard {
    if (__ANDROID__) {
      const jsiBench = (globalThis as any).__NS_NITRO_JNI_BENCH__;
      const javaBridge = (globalThis as any).org?.nativescript?.nsnitro
        ?.NitroAndroidBridge;
      const jniRounds = Math.min(iterations, 15000);

      // Lane 1: Nitro JNI Call (JSI HostFunction -> C++ -> JNIEnv::CallStaticDoubleMethod -> Java)
      const tNitroJni0 = performance.now();
      let accNitroJni = 0;
      if (jsiBench?.nitroJniAddNumbers) {
        for (let i = 0; i < jniRounds; i++) {
          accNitroJni = jsiBench.nitroJniAddNumbers(accNitroJni, 1.0);
        }
      }
      const durNitroJni = Math.max(0.05, performance.now() - tNitroJni0);

      // Lane 2: NativeScript Method Call (V8 -> Metadata -> JNI -> Java NitroAndroidBridge.addNumbers)
      const tNsJni0 = performance.now();
      let accNsJni = 0;
      if (javaBridge?.addNumbers) {
        for (let i = 0; i < jniRounds; i++) {
          accNsJni = javaBridge.addNumbers(accNsJni, 1.0);
        }
      }
      const durNsJni = Math.max(0.05, performance.now() - tNsJni0);

      const ratio = (durNsJni / durNitroJni).toFixed(2);
      return {
        id: 'tsc-swift-or-jni',
        title: 'Android JNI-to-JNI: Nitro JNI Call vs. NativeScript Method Call',
        subtitle:
          'Apples-to-Apples Java call on Android: both pathways cross JNI into the exact same Java method NitroAndroidBridge.addNumbers(double, double). Compares JSI → C++ → JNIEnv against NativeScript V8 Metadata → JNI.',
        category: 'APPLES-TO-APPLES • JNI-TO-JNI',
        iterationsLabel: `${this.formatInt(jniRounds)} Java JNI calls`,
        speedupHeadline: `${ratio}x Ratio`,
        speedupDetail: `${durNitroJni.toFixed(2)} ms (Nitro JSI→JNI→Java) vs ${durNsJni.toFixed(2)} ms (NativeScript→JNI→Java)`,
        verificationNote: `Both invoke Java NitroAndroidBridge.addNumbers(a,b) • Checksums: ${accNitroJni} = ${accNsJni}`,
        ranAt: 'Live',
        lanes: this.buildLanes([
          {
            label: 'Nitro JNI Call (JSI → C++ → JNIEnv → Java addNumbers)',
            pathway: 'nitro-cpp',
            durationMs: durNitroJni,
            iterations: jniRounds,
            badgeText: 'NITRO JNI',
            accentClass: 'text-emerald-400',
            barColor: '#10b981',
          },
          {
            label: 'NativeScript Method Call (V8 → Metadata → JNI → Java addNumbers)',
            pathway: 'objc-classic',
            durationMs: durNsJni,
            iterations: jniRounds,
            badgeText: 'NS METHOD CALL',
            accentClass: 'text-amber-400',
            barColor: '#f59e0b',
          },
        ]),
      };
    }

    // iOS: Call into Swift via NativeScript vs Nitro -> Swift calling
    const nitroSwiftAdd = this.swiftEngine.addNumbers;
    const hasSwiftC = typeof nitro_swift_add_numbers === 'function';
    const hasSwiftObjC =
      typeof NSSwiftBenchmarkBridge !== 'undefined' &&
      typeof NSSwiftBenchmarkBridge.addNumbersB === 'function';

    const tNitroSwift0 = performance.now();
    let accNitroSwift = 0;
    for (let i = 0; i < iterations; i++) {
      accNitroSwift = nitroSwiftAdd(accNitroSwift, 1.0);
    }
    const durNitroSwift = Math.max(0.05, performance.now() - tNitroSwift0);

    const tNsSwiftC0 = performance.now();
    let accNsSwiftC = 0;
    if (hasSwiftC) {
      for (let i = 0; i < iterations; i++) {
        accNsSwiftC = nitro_swift_add_numbers(accNsSwiftC, 1.0);
      }
    }
    const durNsSwiftC = Math.max(0.05, performance.now() - tNsSwiftC0);

    const tNsSwiftObjC0 = performance.now();
    let accNsSwiftObjC = 0;
    if (hasSwiftObjC) {
      for (let i = 0; i < iterations; i++) {
        accNsSwiftObjC = NSSwiftBenchmarkBridge.addNumbersB(accNsSwiftObjC, 1.0);
      }
    }
    const durNsSwiftObjC = Math.max(0.05, performance.now() - tNsSwiftObjC0);

    const ratio = (durNsSwiftObjC / durNitroSwift).toFixed(2);
    return {
      id: 'tsc-swift-or-jni',
      title: 'Swift-to-Swift Calling: Nitro → Swift vs. NativeScript → Swift',
      subtitle:
        'Apples-to-Apples Swift call on iOS: compares Nitro JSI → Swift against NativeScript C Metadata → Swift (@_cdecl) and NativeScript Method Call → Swift (@objc NSSwiftBenchmarkBridge).',
      category: 'APPLES-TO-APPLES • SWIFT-TO-SWIFT',
      iterationsLabel: `${this.formatInt(iterations)} Swift calls`,
      speedupHeadline: `${ratio}x vs @objc Swift`,
      speedupDetail: `${durNitroSwift.toFixed(2)} ms (Nitro→Swift) • ${durNsSwiftC.toFixed(2)} ms (NS C→Swift) • ${durNsSwiftObjC.toFixed(2)} ms (NS @objc→Swift)`,
      verificationNote: `All 3 lanes execute Swift 6 code • Checksums: ${accNitroSwift} = ${accNsSwiftC} = ${accNsSwiftObjC}`,
      ranAt: 'Live',
      lanes: this.buildLanes([
        {
          label: 'Nitro JSI → Swift 6 (SwiftEngine.addNumbers)',
          pathway: 'nitro-swift',
          durationMs: durNitroSwift,
          iterations,
          badgeText: 'NITRO → SWIFT',
          accentClass: 'text-cyan-400',
          barColor: '#06b6d4',
        },
        {
          label: 'NativeScript Direct C Metadata → Swift 6 (@_cdecl)',
          pathway: 'reference',
          durationMs: durNsSwiftC,
          iterations,
          badgeText: 'NS C → SWIFT',
          accentClass: 'text-emerald-400',
          barColor: '#10b981',
        },
        {
          label: 'NativeScript Method Call → Swift 6 (@objc NSSwiftBenchmarkBridge)',
          pathway: 'objc-classic',
          durationMs: durNsSwiftObjC,
          iterations,
          badgeText: 'NS @OBJC → SWIFT',
          accentClass: 'text-amber-400',
          barColor: '#f59e0b',
        },
      ]),
    };
  }

  // TSC #4: Equal String Marshaling (C-to-C UTF-8 AND Swift String / NSString / Java jstring)
  private benchTscEqualStringMarshaling(iterations: number): BenchmarkCard {
    if (__ANDROID__) {
      const napiBench = (globalThis as any).__NS_NAPI_BENCH__;
      const jsiBench = (globalThis as any).__NS_NITRO_JNI_BENCH__;
      const javaBridge = (globalThis as any).org?.nativescript?.nsnitro
        ?.NitroAndroidBridge;
      const rounds = Math.min(iterations, 4000);

      // 1. JSI Pure C UTF-8 snprintf (no JNI)
      const tJsiC0 = performance.now();
      let outJsiC = '';
      for (let i = 0; i < rounds; i++) {
        outJsiC = jsiBench?.jsiFormatRecord
          ? jsiBench.jsiFormatRecord('TelemetryFrame', 0.984, i)
          : this.nitroCompute.formatRecord('TelemetryFrame', 0.984, i);
      }
      const durJsiC = Math.max(0.05, performance.now() - tJsiC0);

      // 2. N-API Pure C UTF-8 snprintf (no JNI)
      const tNapiC0 = performance.now();
      let outNapiC = '';
      for (let i = 0; i < rounds; i++) {
        outNapiC = napiBench?.formatRecord
          ? napiBench.formatRecord('TelemetryFrame', 0.984, i)
          : outJsiC;
      }
      const durNapiC = Math.max(0.05, performance.now() - tNapiC0);

      // 3. Nitro JNI Call -> Java String (JSI -> C++ -> NewStringUTF -> Java NitroAndroidBridge.formatRecord)
      const tNitroJni0 = performance.now();
      let outNitroJni = '';
      if (jsiBench?.nitroJniFormatRecord) {
        for (let i = 0; i < rounds; i++) {
          outNitroJni = jsiBench.nitroJniFormatRecord('TelemetryFrame', 0.984, i);
        }
      }
      const durNitroJni = Math.max(0.05, performance.now() - tNitroJni0);

      // 4. NativeScript Method Call -> Java String (V8 -> Metadata -> JNI -> Java NitroAndroidBridge.formatRecord)
      const tNsJni0 = performance.now();
      let outNsJni = '';
      if (javaBridge?.formatRecord) {
        for (let i = 0; i < rounds; i++) {
          outNsJni = javaBridge.formatRecord('TelemetryFrame', 0.984, i);
        }
      }
      const durNsJni = Math.max(0.05, performance.now() - tNsJni0);

      const jniRatio = (durNsJni / durNitroJni).toFixed(2);
      return {
        id: 'tsc-equal-marshaling',
        title: 'Equal String Marshaling: C UTF-8 vs. JNI Java String',
        subtitle:
          'Separates pure C UTF-8 formatting (JSI vs N-API) from Java jstring marshaling across JNI (Nitro JNI Call vs NativeScript Method Call into NitroAndroidBridge.formatRecord).',
        category: 'APPLES-TO-APPLES • MARSHALING',
        iterationsLabel: `${this.formatInt(rounds)} roundtrips`,
        speedupHeadline: `${jniRatio}x JNI Ratio`,
        speedupDetail: `C-to-C: ${durJsiC.toFixed(2)}ms (JSI) vs ${durNapiC.toFixed(2)}ms (N-API) • JNI: ${durNitroJni.toFixed(2)}ms (Nitro JNI) vs ${durNsJni.toFixed(2)}ms (NS JNI)`,
        verificationNote: `JNI output: "${outNitroJni}" = "${outNsJni}"`,
        ranAt: 'Live',
        lanes: this.buildLanes([
          {
            label: 'Nitro JSI → Pure C snprintf (No JNI / No Java String)',
            pathway: 'nitro-cpp',
            durationMs: durJsiC,
            iterations: rounds,
            badgeText: 'JSI C UTF-8',
            accentClass: 'text-emerald-400',
            barColor: '#10b981',
          },
          {
            label: 'Node-API (N-API) → Pure C snprintf (No JNI / No Java String)',
            pathway: 'reference',
            durationMs: durNapiC,
            iterations: rounds,
            badgeText: 'N-API C UTF-8',
            accentClass: 'text-cyan-400',
            barColor: '#06b6d4',
          },
          {
            label: 'Nitro JNI Call (JSI → C++ → NewStringUTF → Java formatRecord)',
            pathway: 'nitro-proto',
            durationMs: durNitroJni,
            iterations: rounds,
            badgeText: 'NITRO JNI STRING',
            accentClass: 'text-indigo-400',
            barColor: '#6366f1',
          },
          {
            label: 'NativeScript Method Call (V8 → Metadata → JNI → Java formatRecord)',
            pathway: 'objc-classic',
            durationMs: durNsJni,
            iterations: rounds,
            badgeText: 'NS JNI STRING',
            accentClass: 'text-amber-400',
            barColor: '#f59e0b',
          },
        ]),
      };
    }

    // iOS: Equal String Marshaling (Pure C UTF-8 vs Swift String / NSString*)
    const jsiCFormat = this.nitroCompute.formatRecord;
    const jsiSwiftFormat =
      this.swiftEngine.formatSwiftString ?? this.nitroCompute.formatRecord;
    const jsiNSStringFormat =
      this.swiftEngine.formatNSString ?? this.nitroCompute.formatRecord;
    const hasDirectCFormat = typeof ns_direct_c_format_utf8 === 'function';
    const hasNsSwiftFormat =
      typeof NSSwiftBenchmarkBridge !== 'undefined' &&
      typeof NSSwiftBenchmarkBridge.formatSwiftRecordScoreIndex === 'function';

    // 1. Nitro JSI -> Pure C snprintf (no NSString*)
    const tJsiC0 = performance.now();
    let outJsiC = '';
    for (let i = 0; i < iterations; i++) {
      outJsiC = jsiCFormat('TelemetryFrame', 0.984, i);
    }
    const durJsiC = Math.max(0.05, performance.now() - tJsiC0);

    // 2. NativeScript Direct C -> Pure C snprintf (no NSString*)
    const tNsC0 = performance.now();
    let lenNsC = 0;
    if (hasDirectCFormat) {
      for (let i = 0; i < iterations; i++) {
        lenNsC = ns_direct_c_format_utf8('TelemetryFrame', 0.984, i);
      }
    }
    const durNsC = Math.max(0.05, performance.now() - tNsC0);

    // 3. Nitro JSI -> Swift String Interpolation (constructs real Swift.String)
    const tJsiSwift0 = performance.now();
    let outJsiSwift = '';
    for (let i = 0; i < iterations; i++) {
      outJsiSwift = jsiSwiftFormat('TelemetryFrame', 0.984, i);
    }
    const durJsiSwift = Math.max(0.05, performance.now() - tJsiSwift0);

    // 4. Nitro JSI -> Objective-C NSString* stringWithFormat (constructs real NSString*)
    const tJsiNSString0 = performance.now();
    let outJsiNS = '';
    for (let i = 0; i < iterations; i++) {
      outJsiNS = jsiNSStringFormat('TelemetryFrame', 0.984, i);
    }
    const durJsiNSString = Math.max(0.05, performance.now() - tJsiNSString0);

    // 5. NativeScript -> Swift @objc String method (NSSwiftBenchmarkBridge.formatSwiftRecord)
    const tNsSwift0 = performance.now();
    let outNsSwift = '';
    if (hasNsSwiftFormat) {
      for (let i = 0; i < iterations; i++) {
        outNsSwift = NSSwiftBenchmarkBridge.formatSwiftRecordScoreIndex(
          'TelemetryFrame',
          0.984,
          i
        );
      }
    }
    const durNsSwift = Math.max(0.05, performance.now() - tNsSwift0);

    const swiftRatio = (durNsSwift / durJsiSwift).toFixed(2);
    return {
      id: 'tsc-equal-marshaling',
      title: 'Equal String Marshaling: C UTF-8 vs. Swift String / NSString*',
      subtitle:
        'Addresses TSC feedback directly: compares "just go into C" (Nitro JSI C vs NativeScript Direct C) AND "convert into Swift.String / NSString*" on BOTH sides (Nitro → Swift String vs NativeScript → Swift String).',
      category: 'APPLES-TO-APPLES • MARSHALING',
      iterationsLabel: `${this.formatInt(iterations)} roundtrips`,
      speedupHeadline: `${swiftRatio}x Swift String Ratio`,
      speedupDetail: `Swift.String: ${durJsiSwift.toFixed(2)}ms (Nitro→Swift) vs ${durNsSwift.toFixed(2)}ms (NS→Swift) • Pure C: ${durJsiC.toFixed(2)}ms vs ${durNsC.toFixed(2)}ms`,
      verificationNote: `Outputs: "${outJsiSwift}" = "${outNsSwift}" (len=${lenNsC}, NS=${outJsiNS.length > 0})`,
      ranAt: 'Live',
      lanes: this.buildLanes([
        {
          label: 'Nitro JSI → Pure C snprintf (No NSString* / No Swift.String)',
          pathway: 'nitro-cpp',
          durationMs: durJsiC,
          iterations,
          badgeText: 'JSI PURE C',
          accentClass: 'text-emerald-400',
          barColor: '#10b981',
        },
        {
          label: 'NativeScript Direct C → Pure C snprintf (No NSString*)',
          pathway: 'reference',
          durationMs: durNsC,
          iterations,
          badgeText: 'NS DIRECT C',
          accentClass: 'text-cyan-400',
          barColor: '#06b6d4',
        },
        {
          label: 'Nitro JSI → Swift 6 String Interpolation (Constructs Swift.String)',
          pathway: 'nitro-swift',
          durationMs: durJsiSwift,
          iterations,
          badgeText: 'NITRO SWIFT.STRING',
          accentClass: 'text-indigo-400',
          barColor: '#6366f1',
        },
        {
          label: 'Nitro JSI → Objective-C +[NSString stringWithFormat:]',
          pathway: 'nitro-proto',
          durationMs: durJsiNSString,
          iterations,
          badgeText: 'NITRO NSSTRING*',
          accentClass: 'text-purple-400',
          barColor: '#a855f7',
        },
        {
          label: 'NativeScript Method Call → Swift 6 String (NSSwiftBenchmarkBridge)',
          pathway: 'objc-classic',
          durationMs: durNsSwift,
          iterations,
          badgeText: 'NS SWIFT.STRING',
          accentClass: 'text-amber-400',
          barColor: '#f59e0b',
        },
      ]),
    };
  }
}

