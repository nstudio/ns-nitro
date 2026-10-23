import { QuattroEngine } from '../../specs/QuattroEngine.nitro';

const SAMPLE_RATE = 44100;

/**
 * Plays the Group B Quattro flyby. The audio is synthesized in C++ by the `QuattroEngine` Nitro
 * Hybrid Object, written straight into memory the platform audio API owns: the AVAudioPCMBuffer
 * channels on iOS and the direct ByteBuffer behind the AudioTrack on Android.
 */
export class RallyAudioEngine {
  /** Also drives the stage HUD, so the gauges show exactly what is playing. */
  readonly quattro = new QuattroEngine(SAMPLE_RATE);

  private engine: AVAudioEngine | null = null;
  private player: AVAudioPlayerNode | null = null;
  private reverb: AVAudioUnitReverb | null = null;
  private androidTrack: android.media.AudioTrack | null = null;
  private seed = 1;
  private _muted = false;

  get muted(): boolean {
    return this._muted;
  }

  get flybyDurationMs(): number {
    return this.quattro.flybyDuration * 1000;
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
      } catch (e) {
        console.warn('RallyAudioEngine iOS init warning:', e);
      }
      return;
    }

    if (__ANDROID__ && !this.androidTrack) {
      try {
        const { AudioAttributes, AudioFormat, AudioTrack } = android.media;
        const frames = Math.round(SAMPLE_RATE * this.quattro.flybyDuration);
        const byteCount = frames * 2 * 4;
        const directBuf = java.nio.ByteBuffer.allocateDirect(byteCount).order(java.nio.ByteOrder.nativeOrder());
        // Interleaved stereo: C++ fills every other float of the Java buffer for each channel.
        const pcm = (ArrayBuffer as any).from(directBuf) as ArrayBuffer;
        this.quattro.renderInto(pcm, this.seed, 0, 2);
        this.quattro.renderInto(pcm, this.seed, 1, 2);
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
      if (!this.player || !this.ensureRunning()) {
        return;
      }
      try {
        // A fresh seed per flyby, so the gravel spray and backfires never repeat.
        const buffer = this.renderFlybyBuffer(this.seed++);
        this.player.volume = gain;
        this.player.scheduleBufferAtTimeOptionsCompletionHandler(
          buffer,
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

  private renderFlybyBuffer(seed: number): AVAudioPCMBuffer {
    const format = AVAudioFormat.alloc().initStandardFormatWithSampleRateChannels(SAMPLE_RATE, 2);
    const frames = Math.round(SAMPLE_RATE * this.quattro.flybyDuration);
    const buffer = AVAudioPCMBuffer.alloc().initWithPCMFormatFrameCapacity(format, frames);
    buffer.frameLength = frames;
    // The standard format is deinterleaved: one Float32 array per channel. Wrap each without
    // copying so the C++ synthesizer writes directly into the buffer AVAudioEngine plays.
    const channels = buffer.floatChannelData as interop.Reference<interop.Pointer>;
    for (let channel = 0; channel < 2; channel++) {
      const samples = NSData.dataWithBytesNoCopyLengthFreeWhenDone(channels[channel], frames * 4, false);
      this.quattro.renderInto(interop.bufferFromData(samples), seed, channel, 1);
    }
    return buffer;
  }
}
