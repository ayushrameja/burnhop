import { defaultAudioSettings, normalizeAudioSettings, type AudioSettings } from './audioSettings';
import { createSyntheticBuffer, type SyntheticSound } from './audioSynthesis';
import { RELOAD_CUES } from './reload';
import type { GameEvent } from './types';

export interface MovementAudioState {
  x: number; y: number; grounded: boolean; vx: number; vy: number; crouchAmount: number;
}

type Channel = 'weapons' | 'movement';
type Voice = { source: AudioBufferSourceNode; gain: GainNode; filter?: BiquadFilterNode };
const STEP_DISTANCE = Math.PI / 0.045; // Same alternating-foot cadence as the renderer.
const SAMPLE_NAMES = [
  'rifle-1', 'rifle-2', 'rifle-3', 'footstep-1', 'footstep-2', 'footstep-3', 'footstep-4',
  'land', 'impact-metal', 'reload-remove', 'reload-insert', 'reload-rack',
] as const;
type SampleName = typeof SAMPLE_NAMES[number];

/** Simulation events choose the sounds; the audio clock never advances gameplay. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private channels: Partial<Record<Channel, GainNode>> = {};
  private limiter: DynamicsCompressorNode | null = null;
  private samples = new Map<SampleName, AudioBuffer>();
  private synthesized = new Map<SyntheticSound, AudioBuffer>();
  private voices = new Set<Voice>();
  private jet: Voice | null = null;
  private loading: Promise<void> | null = null;
  private requests: AbortController | null = null;
  private resumePending: Promise<void> | null = null;
  private volumes = defaultAudioSettings();
  private muted = false;
  private paused = true;
  private disposed = false;
  private movement: MovementAudioState | null = null;
  private distance = 0;
  private stepIndex = 0;
  private shotIndex = 0;
  private reloadProgress = -1;

  async unlock(): Promise<void> {
    if (this.disposed) return;
    this.paused = false;
    try {
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        this.master = context.createGain();
        this.limiter = context.createDynamicsCompressor();
        this.limiter.threshold.value = -6;
        this.limiter.knee.value = 6;
        this.limiter.ratio.value = 12;
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.09;
        this.master.connect(this.limiter);
        this.limiter.connect(context.destination);
        for (const channel of ['weapons', 'movement'] as const) {
          const gain = context.createGain();
          gain.connect(this.master);
          this.channels[channel] = gain;
        }
        this.loadSamples(context);
      }
      this.syncVolumes();
      const context = this.context;
      if (context.state === 'suspended' && !this.resumePending) {
        this.resumePending = context.resume().catch(() => {}).finally(() => {
          this.resumePending = null;
          if (this.disposed && context.state !== 'closed') this.closeContext(context);
        });
      }
      await this.resumePending;
    } catch { /* Audio policies or missing Web Audio must never block play. */ }
  }

  private loadSamples(context: AudioContext): void {
    if (this.loading) return;
    const requests = new AbortController();
    this.requests = requests;
    this.loading = Promise.all(SAMPLE_NAMES.map(async name => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/sfx/${name}.wav`, { signal: requests.signal });
        if (!response.ok) return;
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!this.disposed && this.context === context) this.samples.set(name, buffer);
      } catch { /* Use the local synthesized layer if fetch/decode is unavailable. */ }
    })).then(() => {});
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncVolumes();
    if (muted) this.stopVoices();
  }

  setVolumes(settings: AudioSettings): void {
    this.volumes = normalizeAudioSettings(settings);
    this.syncVolumes();
    if (this.volumes.masterVolume === 0 || this.volumes.movementVolume === 0) this.stopJet();
  }

  private syncVolumes(): void {
    if (this.master) this.master.gain.value = this.muted || this.paused || this.disposed ? 0 : this.volumes.masterVolume;
    if (this.channels.weapons) this.channels.weapons.gain.value = this.volumes.weaponsVolume;
    if (this.channels.movement) this.channels.movement.gain.value = this.volumes.movementVolume;
  }

  private canPlay(channel: Channel): boolean {
    return !this.disposed && !this.paused && !this.muted && this.context?.state === 'running'
      && this.volumes.masterVolume > 0 && this.volumes[channel === 'weapons' ? 'weaponsVolume' : 'movementVolume'] > 0;
  }

  private fallback(sound: SyntheticSound): AudioBuffer {
    let buffer = this.synthesized.get(sound);
    if (!buffer) {
      buffer = createSyntheticBuffer(this.context!, sound);
      this.synthesized.set(sound, buffer);
    }
    return buffer;
  }

  private playSample(name: SampleName, fallback: SyntheticSound, channel: Channel, volume: number, rate = 1): void {
    if (!this.canPlay(channel)) return;
    const context = this.context!;
    let voice: Voice | null = null;
    try {
      // Bound simultaneous tails during sustained fire or catch-up simulation ticks.
      if (this.voices.size >= 24) this.stopVoice(this.voices.values().next().value!);
      voice = { source: context.createBufferSource(), gain: context.createGain() };
      voice.source.buffer = this.samples.get(name) ?? this.fallback(fallback);
      voice.source.playbackRate.value = rate;
      voice.gain.gain.value = volume;
      voice.source.connect(voice.gain);
      voice.gain.connect(this.channels[channel]!);
      const activeVoice = voice;
      voice.source.onended = () => this.disconnectVoice(activeVoice);
      this.voices.add(voice);
      voice.source.start();
    } catch {
      if (voice) this.disconnectVoice(voice);
    }
  }

  setThrust(active: boolean): void {
    if (!active || !this.canPlay('movement')) { this.stopJet(); return; }
    if (this.jet) return;
    const context = this.context!;
    let voice: Voice | null = null;
    try {
      voice = { source: context.createBufferSource(), gain: context.createGain(), filter: context.createBiquadFilter() };
      voice.source.buffer = this.fallback('jet');
      voice.source.loop = true;
      voice.filter!.type = 'lowpass';
      voice.filter!.frequency.value = 1800;
      voice.filter!.Q.value = 0.65;
      voice.gain.gain.setValueAtTime(0, context.currentTime);
      voice.gain.gain.setTargetAtTime(0.38, context.currentTime, 0.045);
      voice.source.connect(voice.filter!);
      voice.filter!.connect(voice.gain);
      voice.gain.connect(this.channels.movement!);
      const activeVoice = voice;
      voice.source.onended = () => this.disconnectVoice(activeVoice);
      this.voices.add(voice);
      this.jet = voice;
      voice.source.start();
    } catch {
      if (voice) this.disconnectVoice(voice);
    }
  }

  private stopJet(): void {
    const jet = this.jet;
    if (!jet) return;
    this.jet = null;
    const time = this.context?.currentTime ?? 0;
    jet.gain.gain.cancelScheduledValues(time);
    jet.gain.gain.setTargetAtTime(0, time, 0.025);
    try { jet.source.stop(time + 0.09); } catch { this.disconnectVoice(jet); }
  }

  /** Called after each fixed simulation step, using actual travel rather than held keys. */
  updateMovement(state: MovementAudioState): void {
    if (this.disposed || this.paused) return;
    const previous = this.movement;
    this.movement = { ...state };
    if (!previous) return;
    const moved = Math.abs(state.x - previous.x);
    if (moved > 48 || Math.abs(state.y - previous.y) > 80) { this.distance = 0; return; }
    if (state.grounded && !previous.grounded) {
      const impact = Math.max(0.15, Math.min(1, Math.max(0, previous.vy) / 650));
      // The cue already contains both boot contacts and a little gear movement.
      // Impact changes loudness, not pitch: slowing it suggests a rubber bounce.
      this.playSample('land', 'land', 'movement', 0.27 + impact * 0.58);
      this.distance = 0;
    } else if (state.grounded && previous.grounded) {
      this.distance += moved;
      if (this.distance >= STEP_DISTANCE) {
        this.distance %= STEP_DISTANCE;
        const crouch = Math.max(0, Math.min(1, state.crouchAmount));
        this.playSample(`footstep-${this.stepIndex++ % 4 + 1}` as SampleName, 'footstep', 'movement',
          0.48 * (1 - crouch * 0.45), 0.94 + Math.random() * 0.1 - crouch * 0.035);
      }
    } else this.distance = 0;
    if (this.jet && this.context) {
      this.jet.filter?.frequency.setTargetAtTime(1500 + Math.min(450, Math.abs(state.vy) * 0.7), this.context.currentTime, 0.08);
      this.jet.source.playbackRate.setTargetAtTime(0.96 + Math.min(0.1, Math.abs(state.vy) / 5000), this.context.currentTime, 0.08);
    }
  }

  /** -1 resets the timeline; cue crossings follow simulation progress and cannot drift on pause. */
  updateReload(progress: number): void {
    if (!Number.isFinite(progress) || progress < 0) { this.reloadProgress = -1; return; }
    if (this.disposed || this.paused) return;
    const next = Math.max(0, Math.min(1, progress));
    const previous = this.reloadProgress < 0 || next < this.reloadProgress ? 0 : this.reloadProgress;
    this.reloadProgress = next;
    for (const [stage, threshold] of Object.entries(RELOAD_CUES) as [keyof typeof RELOAD_CUES, number][]) {
      if (previous < threshold && next >= threshold) {
        this.playSample(`reload-${stage}`, stage, 'weapons', stage === 'rack' ? 0.64 : 0.6, 0.99 + Math.random() * 0.02);
      }
    }
  }

  play(events: GameEvent[]): void {
    if (this.disposed || this.paused) return;
    for (const event of events) {
      if (event.type === 'shot') this.playSample(`rifle-${this.shotIndex++ % 3 + 1}` as SampleName, 'rifle', 'weapons', 0.72, 0.98 + Math.random() * 0.04);
      if (event.type === 'hit') this.playSample('impact-metal', 'impact', 'weapons', 0.22, 1.08);
      if (event.type === 'targetDeath') this.playSample('land', 'land', 'weapons', 0.42);
      if (event.type === 'jump') this.playSample(`footstep-${this.stepIndex++ % 4 + 1}` as SampleName, 'footstep', 'movement', 0.26, 1.15);
      // Reload stages and impact-scaled landings are handled by their simulation updates.
    }
  }

  /** Cut every voice immediately; no scheduled Foley continues behind the pause screen. */
  pause(): void {
    this.paused = true;
    this.movement = null;
    this.distance = 0;
    this.syncVolumes();
    this.stopVoices();
  }

  private disconnectVoice(voice: Voice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.filter?.disconnect();
    voice.gain.disconnect();
    this.voices.delete(voice);
    if (this.jet === voice) this.jet = null;
  }

  private stopVoice(voice: Voice): void {
    try { voice.source.stop(); } catch { /* It may have ended between frames. */ }
    this.disconnectVoice(voice);
  }

  private stopVoices(): void {
    for (const voice of this.voices) this.stopVoice(voice);
    this.jet = null;
  }

  private closeContext(context: AudioContext): void {
    try { void context.close().catch(() => {}); } catch { /* Browser teardown can close it first. */ }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.requests?.abort();
    for (const channel of Object.values(this.channels)) channel.disconnect();
    this.master?.disconnect();
    this.limiter?.disconnect();
    if (this.context) this.closeContext(this.context);
    this.context = null;
    this.master = null;
    this.limiter = null;
    this.channels = {};
    this.samples.clear();
    this.synthesized.clear();
  }
}
