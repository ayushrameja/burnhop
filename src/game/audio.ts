import { defaultAudioSettings, normalizeAudioSettings, type AudioSettings } from './audioSettings';
import { createSyntheticBuffer, weaponSoundId, type SyntheticSound } from './audioSynthesis';
import { getReloadProgress, RELOAD_CUES } from './reload';
import { lowHealthActive } from './feedback';
import { WEAPONS } from './weapons';
import type { GameEvent, WeaponState } from './types';

export interface MovementAudioState {
  x: number; y: number; grounded: boolean; vx: number; vy: number; crouchAmount: number;
}

type Channel = 'weapons' | 'movement' | 'feedback';
type Voice = { source: AudioBufferSourceNode; gain: GainNode; filter?: BiquadFilterNode; panner?: StereoPannerNode;
  priority: number; local: boolean; level: number; sound: SyntheticSound };
type ActorSoundState = { movement: MovementAudioState | null; distance: number; stepIndex: number; shotIndex: number; reloadProgress: number; jet: Voice | null };
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
  private actors = new Map<string, ActorSoundState>();
  private spatialVolume = 1;
  private spatialPan = 0;
  private spatialLocal = true;
  private heartbeatActive = false;
  private nextHeartbeat = 0;
  private reloadTimelines = new Map<string, number>();

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
        for (const channel of ['weapons', 'movement', 'feedback'] as const) {
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
    if (this.volumes.masterVolume === 0) this.stopVoices();
  }

  private syncVolumes(): void {
    if (this.master) this.master.gain.value = this.muted || this.paused || this.disposed ? 0 : this.volumes.masterVolume;
    if (this.channels.weapons) this.channels.weapons.gain.value = this.volumes.weaponsVolume;
    if (this.channels.movement) this.channels.movement.gain.value = this.volumes.movementVolume;
    if (this.channels.feedback) this.channels.feedback.gain.value = this.volumes.feedbackVolume;
  }

  private canPlay(channel: Channel): boolean {
    return !this.disposed && !this.paused && !this.muted && this.context?.state === 'running'
      && this.volumes.masterVolume > 0 && this.volumes[channel === 'weapons' ? 'weaponsVolume' : channel === 'feedback' ? 'feedbackVolume' : 'movementVolume'] > 0;
  }

  private fallback(sound: SyntheticSound): AudioBuffer {
    let buffer = this.synthesized.get(sound);
    if (!buffer) {
      buffer = createSyntheticBuffer(this.context!, sound);
      this.synthesized.set(sound, buffer);
    }
    return buffer;
  }

  /** Reserve four slots for local cues. Distant or low-priority tails yield first. */
  private claimVoice(priority: number): boolean {
    const remote = [...this.voices].filter(voice => !voice.local);
    const crowded = this.voices.size >= 24 || (!this.spatialLocal && remote.length >= 20);
    if (!crowded) return true;
    const candidates = [...this.voices].filter(voice => (!this.spatialLocal ? !voice.local : true)
      && (!voice.local || voice.priority <= priority));
    candidates.sort((a, b) => Number(a.local) - Number(b.local) || a.priority - b.priority || a.level - b.level);
    const victim = candidates[0];
    if (!victim || (!this.spatialLocal && (victim.priority > priority || (victim.priority === priority && victim.level > this.spatialVolume)))) return false;
    this.stopVoice(victim); return true;
  }

  private routeVoice(voice: Voice, channel: Channel): void {
    // Mono remains a supported fallback for devices without a stereo panner.
    if (typeof this.context?.createStereoPanner === 'function') {
      voice.panner = this.context.createStereoPanner();
      voice.panner.pan.value = this.spatialPan;
      voice.gain.connect(voice.panner); voice.panner.connect(this.channels[channel]!);
    } else voice.gain.connect(this.channels[channel]!);
  }

  private playSample(name: SampleName | null, fallback: SyntheticSound, channel: Channel, volume: number, rate = 1, priority = 2): void {
    if (!this.canPlay(channel) || this.spatialVolume <= .001 || !this.claimVoice(priority)) return;
    const context = this.context!;
    let voice: Voice | null = null;
    try {
      voice = { source: context.createBufferSource(), gain: context.createGain(), priority, local: this.spatialLocal, level: this.spatialVolume, sound: fallback };
      voice.source.buffer = (name ? this.samples.get(name) : undefined) ?? this.fallback(fallback);
      voice.source.playbackRate.value = rate;
      voice.gain.gain.value = volume * this.spatialVolume;
      voice.source.connect(voice.gain);
      this.routeVoice(voice, channel);
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
    if (this.jet || !this.claimVoice(0)) return;
    const context = this.context!;
    let voice: Voice | null = null;
    try {
      voice = { source: context.createBufferSource(), gain: context.createGain(), filter: context.createBiquadFilter(),
        priority: 0, local: this.spatialLocal, level: this.spatialVolume, sound: 'jet' };
      voice.source.buffer = this.fallback('jet');
      voice.source.loop = true;
      voice.filter!.type = 'lowpass';
      voice.filter!.frequency.value = 1800;
      voice.filter!.Q.value = 0.65;
      voice.gain.gain.setValueAtTime(0, context.currentTime);
      voice.gain.gain.setTargetAtTime(0.38 * this.spatialVolume, context.currentTime, 0.045);
      voice.source.connect(voice.filter!);
      voice.filter!.connect(voice.gain);
      this.routeVoice(voice, 'movement');
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

  /** Each physical weapon owns a cue ledger, including sequential dual reloads. */
  updateWeaponReloads(actorId: string, weapon: WeaponState, offhand: WeaponState | null = null): void {
    const retained = new Set<string>();
    for (const equipped of [weapon, offhand]) {
      if (!equipped) continue;
      const key = `${actorId}:${equipped.instanceId}`;
      retained.add(key);
      const progress = getReloadProgress(equipped.reloadTicks, WEAPONS[equipped.weaponId].reloadTicks);
      if (progress < 0) { this.reloadTimelines.set(key, -1); continue; }
      if (this.disposed || this.paused) continue;
      const last = this.reloadTimelines.get(key);
      // First observation may be mid-reload after join/respawn; do not play its history.
      if (last === undefined) { this.reloadTimelines.set(key, progress); continue; }
      const previous = last < 0 || progress < last ? 0 : last;
      this.reloadTimelines.set(key, progress);
      for (const [stage, threshold] of Object.entries(RELOAD_CUES) as [keyof typeof RELOAD_CUES, number][]) {
        if (previous < threshold && progress >= threshold) {
          this.playSample(null, `reload-${equipped.weaponId}-${stage}`, 'weapons', .48, 1, 1);
        }
      }
    }
    for (const key of this.reloadTimelines.keys()) if (key.startsWith(`${actorId}:`) && !retained.has(key)) this.reloadTimelines.delete(key);
  }

  private localFeedback(sound: SyntheticSound, volume: number): void {
    const saved = { volume: this.spatialVolume, pan: this.spatialPan, local: this.spatialLocal };
    this.spatialVolume = 1; this.spatialPan = 0; this.spatialLocal = true;
    this.playSample(null, sound, 'feedback', volume, 1, 4);
    this.spatialVolume = saved.volume; this.spatialPan = saved.pan; this.spatialLocal = saved.local;
  }
  playKillConfirmation(): void { this.localFeedback('kill', .42); }
  playPickup(sniper = false): void { this.localFeedback(sniper ? 'sniper-pickup' : 'pickup', sniper ? .44 : .3); }
  playDropWarning(): void { this.localFeedback('drop-warning', .35); }

  /** The runtime supplies live health; no timer can continue behind a paused match. */
  setHeartbeat(active: boolean, health = 100): void {
    this.heartbeatActive = active && lowHealthActive(health, this.heartbeatActive) && this.canPlay('feedback');
    if (!this.heartbeatActive) {
      this.nextHeartbeat = 0;
      for (const voice of this.voices) if (voice.sound === 'heartbeat') this.stopVoice(voice);
      return;
    }
    const now = this.context!.currentTime;
    if (now >= this.nextHeartbeat) { this.localFeedback('heartbeat', .12); this.nextHeartbeat = now + 1; }
  }

  getDiagnostics() { return { voices: this.voices.size, remoteVoices: [...this.voices].filter(voice => !voice.local).length,
    heartbeat: this.heartbeatActive, reloadTimelines: this.reloadTimelines.size }; }

  play(events: GameEvent[]): void {
    if (this.disposed || this.paused) return;
    for (const event of events) {
      if (event.type === 'shot') {
        const weapon = weaponSoundId(event.weaponId);
        if (weapon) this.playSample(null, `shot-${weapon}`, 'weapons', weapon === 'sniper' ? .85 : .72, .99 + (event.shotCounter % 3) * .01);
        else this.playSample(`rifle-${this.shotIndex++ % 3 + 1}` as SampleName, 'rifle', 'weapons', .72, .98 + Math.random() * .04);
        if (event.surface && event.surface !== 'body') {
          this.playSample(event.surface === 'bunker' ? 'impact-metal' : null,
            event.surface === 'wood' ? 'impact-wood' : event.surface === 'bunker' ? 'impact' : 'impact-rock', 'weapons', .14, 1, 1);
        }
      }
      if (event.type === 'hit') this.playSample(null, event.weaponId ? 'impact-body' : 'punch-hit', 'weapons', .27, 1, 2);
      if (event.type === 'meleeStart') this.playSample(null, 'punch-swing', 'weapons', .32, 1, 1);
      if (event.type === 'dryfire') this.playSample(null, 'dry', 'weapons', .3, 1, 2);
      if (event.type === 'jump') this.playSample(`footstep-${this.stepIndex++ % 4 + 1}` as SampleName, 'footstep', 'movement', 0.26, 1.15);
      // Reload stages and impact-scaled landings are handled by their simulation updates.
    }
  }

  /** One audio context, independent footsteps/reload/jet state for each online actor. */
  updateActor(id: string, state: MovementAudioState & { weapon?: WeaponState; offhand?: WeaponState | null }, reloadProgress: number, thrusting: boolean,
    events: GameEvent[], listener: { x: number; y: number }, local = false): void {
    if (this.disposed || this.paused) return;
    const practice: ActorSoundState = { movement: this.movement, distance: this.distance, stepIndex: this.stepIndex,
      shotIndex: this.shotIndex, reloadProgress: this.reloadProgress, jet: this.jet };
    const actor = this.actors.get(id) ?? { movement: null, distance: 0, stepIndex: 0, shotIndex: 0, reloadProgress: -1, jet: null };
    Object.assign(this, actor);
    this.spatialLocal = local;
    this.spatialPan = local ? 0 : Math.max(-.85, Math.min(.85, (state.x - listener.x) / 800));
    this.spatialVolume = local ? 1 : Math.max(0, 0.7 * (1 - Math.hypot(state.x - listener.x, state.y - listener.y) / 1500));
    this.play(events); this.updateMovement(state);
    if (state.weapon) this.updateWeaponReloads(id, state.weapon, state.offhand); else this.updateReload(reloadProgress);
    this.setThrust(thrusting && this.spatialVolume > 0);
    if (this.jet && this.context) this.jet.gain.gain.setTargetAtTime(0.38 * this.spatialVolume, this.context.currentTime, 0.05);
    if (this.jet?.panner) this.jet.panner.pan.value = this.spatialPan;
    this.actors.set(id, { movement: this.movement, distance: this.distance, stepIndex: this.stepIndex,
      shotIndex: this.shotIndex, reloadProgress: this.reloadProgress, jet: this.jet });
    Object.assign(this, practice); this.spatialVolume = 1; this.spatialPan = 0; this.spatialLocal = true;
  }

  retainActors(ids: ReadonlySet<string>): void {
    for (const [id, actor] of this.actors) if (!ids.has(id)) {
      if (actor.jet) this.stopVoice(actor.jet);
      this.actors.delete(id);
      for (const key of this.reloadTimelines.keys()) if (key.startsWith(`${id}:`)) this.reloadTimelines.delete(key);
    }
    for (const key of this.reloadTimelines.keys()) if (!ids.has(key.slice(0, key.indexOf(':')))) this.reloadTimelines.delete(key);
  }

  /** Cut every voice immediately; no scheduled Foley continues behind the pause screen. */
  pause(): void {
    this.paused = true;
    this.movement = null;
    this.distance = 0;
    this.syncVolumes();
    this.stopVoices();
    this.actors.clear();
    this.heartbeatActive = false; this.nextHeartbeat = 0;
  }

  private disconnectVoice(voice: Voice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.filter?.disconnect();
    voice.panner?.disconnect();
    voice.gain.disconnect();
    this.voices.delete(voice);
    if (this.jet === voice) this.jet = null;
    for (const actor of this.actors.values()) if (actor.jet === voice) actor.jet = null;
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
    this.reloadTimelines.clear();
  }
}
