const SAMPLE_RATE = 44100;
const CACHE_VERSION = 2;

/**
 * Synthesizes an authentic Group B 5-Cylinder Turbo Rally Car Flyby:
 * - Inline-5 uneven firing warble (2.5 pulses/rev + 0.5x half-order growl)
 * - Rev climb through 2 gearshifts + airborne crest rev-limiter + Doppler pass-by
 * - High-frequency turbocharger compressor spool whistle
 * - Iconic Group B wastegate flutter ("stututu!") on crest liftoff
 * - Gravel rooster-tail roar & exhaust backfire crackle
 */
function synthesizeQuattroFlyby(durationSec = 2.15, sampleRate = SAMPLE_RATE): Float32Array {
  const totalSamples = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(totalSamples);

  let phase1 = 0;
  let phase2 = 0;
  let phaseHalf = 0;
  let phaseTurbo = 0;
  let noiseFilter = 0;
  let gravelFilter = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const norm = t / durationSec;

    // RPM envelope:
    // 0.00 - 0.42s: 2nd gear hard pull up the dirt hill (4200 -> 7800 RPM)
    // 0.42 - 0.48s: Upshift + wastegate chirp
    // 0.48 - 1.05s: 3rd gear full boost crest jump (5600 -> 8400 RPM airborne!)
    // 1.05 - 1.28s: Crest liftoff wastegate flutter ("stututu")
    // 1.28 - 2.15s: Landing + Doppler flyby deceleration (7600 -> 4800 RPM)
    let rpm = 4200;
    let throttle = 1.0;
    let flutter = 0.0;

    if (t < 0.42) {
      rpm = 4200 + 3600 * Math.pow(t / 0.42, 0.85);
      throttle = 0.95;
    } else if (t < 0.48) {
      rpm = 6200;
      throttle = 0.25;
      flutter = Math.sin((t - 0.42) * 2 * Math.PI * 38) * 0.7;
    } else if (t < 1.05) {
      const p = (t - 0.48) / 0.57;
      rpm = 5600 + 2800 * Math.pow(p, 0.8);
      throttle = 1.0;
      // Brief rev-limiter bounce at peak jump (0.88 - 1.05s)
      if (t > 0.88) {
        rpm += Math.sin(t * 2 * Math.PI * 28) * 260;
      }
    } else if (t < 1.32) {
      const p = (t - 1.05) / 0.27;
      rpm = 8100 - 1500 * p;
      throttle = 0.35;
      // Iconic Group B Audi S1 turbo compressor surge flutter ("stu-tu-tu-tu!")
      const flutterFreq = 26 - p * 8;
      flutter = Math.max(0, Math.sin((t - 1.05) * 2 * Math.PI * flutterFreq)) * (1.0 - p * 0.45);
    } else {
      const p = (t - 1.32) / (durationSec - 1.32);
      // Doppler drop as car rockets past camera
      rpm = 6800 - 2300 * Math.pow(p, 0.7);
      throttle = 0.8 * (1 - p * 0.5);
    }

    // Doppler shift factor (approaching > 1.0, passing at t=1.0s, receding < 1.0)
    const doppler = 1.0 - 0.16 * Math.tanh((t - 0.98) * 3.2);

    // 5-cylinder firing frequency: 2.5 fires per revolution
    const f0 = (rpm / 60) * 2.5 * doppler;
    // Half-order warble (gives the inline-5 its famous off-beat growl)
    const fHalf = f0 * 0.4;

    phase1 += (2 * Math.PI * f0) / sampleRate;
    phase2 += (2 * Math.PI * f0 * 2.0) / sampleRate;
    phaseHalf += (2 * Math.PI * fHalf) / sampleRate;

    // Non-linear waveshaping for aggressive rally exhaust bark
    const rawEngine =
      0.52 * Math.sin(phase1) +
      0.28 * Math.sin(phase2 + 0.4) +
      0.24 * Math.sin(phase1 * 1.5 + Math.sin(phaseHalf)) +
      0.18 * Math.sin(phaseHalf);
    const bark = Math.tanh(rawEngine * (2.2 + throttle * 1.6));

    // Turbocharger whistle (2.6 kHz - 5.4 kHz)
    const turboFreq = (2400 + (rpm - 4000) * 0.68) * doppler;
    phaseTurbo += (2 * Math.PI * turboFreq) / sampleRate;
    const turboWhistle = Math.sin(phaseTurbo) * (0.09 * throttle + 0.16 * flutter);

    // Wastegate "stututu" broadband air chop + gravel spray
    const white = Math.random() * 2 - 1;
    noiseFilter = 0.78 * noiseFilter + 0.22 * white;
    gravelFilter = 0.92 * gravelFilter + 0.08 * white;

    const wastegateSound = noiseFilter * flutter * 0.55;
    // Gravel kickup peaks at launch (t=0.25) and landing (t=1.35)
    const gravelEnv =
      0.35 * Math.exp(-Math.pow((t - 0.35) / 0.28, 2)) +
      0.45 * Math.exp(-Math.pow((t - 1.38) / 0.32, 2));
    const gravelSound = gravelFilter * gravelEnv;

    // Exhaust crackle/pop on overrun (1.06 - 1.30s)
    let pop = 0;
    if (t > 1.06 && t < 1.30 && Math.random() < 0.008) {
      pop = (Math.random() * 2 - 1) * 0.85;
    }

    // Distance/pass-by amplitude envelope
    const attack = Math.min(1, t / 0.08);
    const passByPeak = 0.55 + 0.45 * Math.exp(-Math.pow((t - 0.92) / 0.55, 2));
    const fadeOut = norm < 0.82 ? 1.0 : Math.max(0, (1.0 - norm) / 0.18);

    const mix =
      (bark * (0.55 + 0.25 * throttle) + turboWhistle + wastegateSound + gravelSound + pop) *
      attack *
      passByPeak *
      fadeOut;

    samples[i] = Math.max(-0.98, Math.min(0.98, mix));
  }

  return samples;
}

function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const pcm = new Int16Array(buffer, 44, samples.length);
  for (let n = 0; n < samples.length; n++) {
    const clipped = samples[n] > 1 ? 1 : samples[n] < -1 ? -1 : samples[n];
    pcm[n] = Math.round(clipped * 32767);
  }
  return buffer;
}

export class RallyAudioEngine {
  private engine: AVAudioEngine | null = null;
  private player: AVAudioPlayerNode | null = null;
  private reverb: AVAudioUnitReverb | null = null;
  private flybyBuffer: AVAudioPCMBuffer | null = null;
  private androidTrack: android.media.AudioTrack | null = null;
  private _muted = false;

  get muted(): boolean {
    return this._muted;
  }

  toggleMute(): boolean {
    this._muted = !this._muted;
    if (this._muted) {
      if (__APPLE__ && this.player?.playing) {
        this.player.stop();
      } else if (__ANDROID__ && this.androidTrack) {
        try {
          if (this.androidTrack.getPlayState() === android.media.AudioTrack.PLAYSTATE_PLAYING) {
            this.androidTrack.stop();
          }
        } catch {}
      }
    }
    return this._muted;
  }

  start(): void {
    if (__APPLE__) {
      if (this.engine) {
        return;
      }
      try {
        const session = AVAudioSession.sharedInstance();
        session.setCategoryError(AVAudioSessionCategoryPlayback);
        session.setActiveError(true);

        const engine = AVAudioEngine.new();
        const stereo = AVAudioFormat.alloc().initStandardFormatWithSampleRateChannels(SAMPLE_RATE, 2);

        const player = AVAudioPlayerNode.new();
        const reverb = AVAudioUnitReverb.new();
        reverb.loadFactoryPreset(AVAudioUnitReverbPreset.MediumHall);
        reverb.wetDryMix = 24;

        engine.attachNode(player);
        engine.attachNode(reverb);
        engine.connectToFormat(player, reverb, stereo);
        engine.connectToFormat(reverb, engine.mainMixerNode, stereo);

        this.engine = engine;
        this.player = player;
        this.reverb = reverb;
        this.ensureRunning();
        this.flybyBuffer = this.loadOrSynthesizeBuffer();
      } catch (e) {
        console.warn('RallyAudioEngine iOS init warning:', e);
      }
      return;
    }

    if (__ANDROID__ && !this.androidTrack) {
      try {
        const { AudioAttributes, AudioFormat, AudioTrack } = android.media;
        const mono = synthesizeQuattroFlyby(2.15, SAMPLE_RATE);
        const totalFrames = mono.length;
        const byteCount = totalFrames * 2 * 4; // Stereo Float32
        const directBuf = java.nio.ByteBuffer.allocateDirect(byteCount).order(
          java.nio.ByteOrder.nativeOrder(),
        );
        const stereoFloats = new Float32Array((ArrayBuffer as any).from(directBuf));
        // Subtle 14 ms stereo canyon slapback offset on right channel for wide rally stage image
        const delaySamples = Math.floor(SAMPLE_RATE * 0.014);
        for (let i = 0; i < totalFrames; i++) {
          const dry = mono[i];
          const slap = i >= delaySamples ? mono[i - delaySamples] * 0.24 : 0;
          stereoFloats[i * 2] = Math.max(-0.98, Math.min(0.98, dry + slap * 0.5));
          stereoFloats[i * 2 + 1] = Math.max(-0.98, Math.min(0.98, dry * 0.92 + slap));
        }
        directBuf.position(0);
        directBuf.limit(byteCount);

        const track = new AudioTrack.Builder()
          .setAudioAttributes(
            new AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_GAME)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          )
          .setAudioFormat(
            new AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
              .setSampleRate(SAMPLE_RATE)
              .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
              .build(),
          )
          .setBufferSizeInBytes(byteCount)
          .setTransferMode(AudioTrack.MODE_STATIC)
          .build();

        track.write(directBuf, byteCount, AudioTrack.WRITE_BLOCKING);
        this.androidTrack = track;
      } catch (e) {
        console.warn('RallyAudioEngine Android init warning:', e);
      }
    }
  }

  playFlyby(intensity = 1.0): void {
    if (this._muted) {
      return;
    }
    const gain = Math.min(1.0, Math.max(0.35, intensity));

    if (__APPLE__) {
      if (!this.engine) {
        this.start();
      }
      if (!this.player || !this.flybyBuffer || !this.ensureRunning()) {
        return;
      }
      try {
        this.player.volume = gain;
        this.player.scheduleBufferAtTimeOptionsCompletionHandler(
          this.flybyBuffer,
          null,
          AVAudioPlayerNodeBufferOptions.Interrupts,
          null,
        );
        if (!this.player.playing) {
          this.player.play();
        }
      } catch (e) {
        console.warn('RallyAudioEngine iOS playFlyby warning:', e);
      }
      return;
    }

    if (__ANDROID__) {
      if (!this.androidTrack) {
        this.start();
      }
      if (!this.androidTrack) {
        return;
      }
      try {
        if (this.androidTrack.getPlayState() === android.media.AudioTrack.PLAYSTATE_PLAYING) {
          this.androidTrack.stop();
        }
        this.androidTrack.reloadStaticData();
        this.androidTrack.setVolume(gain);
        this.androidTrack.play();
      } catch (e) {
        console.warn('RallyAudioEngine Android playFlyby warning:', e);
      }
    }
  }

  dispose(): void {
    if (__APPLE__) {
      try {
        this.player?.stop();
        this.engine?.stop();
      } catch {}
      this.player = null;
      this.engine = null;
      return;
    }
    if (__ANDROID__ && this.androidTrack) {
      try {
        this.androidTrack.stop();
        this.androidTrack.release();
      } catch {}
      this.androidTrack = null;
    }
  }

  private ensureRunning(): boolean {
    if (!this.engine) {
      return false;
    }
    return this.engine.running || this.engine.startAndReturnError();
  }

  private loadOrSynthesizeBuffer(): AVAudioPCMBuffer | null {
    const path = `${NSTemporaryDirectory()}quattro-flyby-v${CACHE_VERSION}.wav`;
    if (!NSFileManager.defaultManager.fileExistsAtPath(path)) {
      const wav = encodeWav(synthesizeQuattroFlyby());
      NSData.dataWithBytesLength(wav as any, wav.byteLength).writeToFileAtomically(path, true);
    }
    const file = AVAudioFile.alloc().initForReadingError(NSURL.fileURLWithPath(path));
    if (!file) {
      return null;
    }
    const buffer = AVAudioPCMBuffer.alloc().initWithPCMFormatFrameCapacity(
      file.processingFormat,
      file.length,
    );
    return file.readIntoBufferError(buffer) ? buffer : null;
  }
}
