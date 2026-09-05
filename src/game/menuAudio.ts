import { defaultAudioSettings, normalizeAudioSettings, type AudioSettings } from './audioSettings';

const UI_VOLUME = 0.3;
const HOVER_INTERVAL = 0.065;

type Tone = { oscillator: OscillatorNode; gain: GainNode };

/** App-owned menu audio. Playback is presentation only and never drives gameplay. */
export class MenuAudio {
  private music: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private tones = new Set<Tone>();
  private unlocked = false;
  private musicActive = false;
  private muted = false;
  private volumes = defaultAudioSettings();
  private visible = true;
  private disposed = false;
  private playPending = false;
  private mediaUnlocked = false;
  private resumePending = false;
  private revision = 0;
  private lastHover = -Infinity;

  /** Call directly from a user gesture; both browser playback requests begin synchronously. */
  unlock(): void {
    if (this.disposed) return;
    this.unlocked = true;
    this.revision++;

    try {
      if (!this.music) {
        this.music = new Audio(`${import.meta.env.BASE_URL}assets/audio/midnight-hangar.mp3`);
        this.music.loop = true;
        this.music.volume = this.volumes.masterVolume * this.volumes.musicVolume;
        this.music.preload = 'auto';
      }
    } catch { /* Music is optional if the browser cannot create a media element. */ }
    this.syncMusic(true);

    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
      }
      this.syncUiVolume();
      const context = this.context;
      if (context.state === 'suspended' && !this.resumePending) {
        this.resumePending = true;
        void context.resume().then(() => {
          this.resumePending = false;
          if (this.disposed && context.state !== 'closed') this.closeContext(context);
        }, () => { this.resumePending = false; });
      }
    } catch {
      this.resumePending = false;
      // Sound must not prevent navigation when browser audio policies deny it.
    }
  }

  setMusicActive(active: boolean): void {
    if (this.disposed || this.musicActive === active) return;
    this.musicActive = active;
    this.revision++;
    this.syncMusic();
  }

  setMuted(muted: boolean): void {
    if (this.disposed || this.muted === muted) return;
    this.muted = muted;
    this.revision++;
    this.syncUiVolume();
    this.syncMusic();
  }

  setVolumes(volumes: AudioSettings): void {
    if (this.disposed) return;
    this.volumes = normalizeAudioSettings(volumes);
    this.revision++;
    this.syncUiVolume();
    this.syncMusic();
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.revision++;
    this.syncUiVolume();
    this.syncMusic();
  }

  private shouldPlayMusic(): boolean {
    return this.unlocked && this.musicActive && this.visible && !this.muted && !this.disposed &&
      this.volumes.masterVolume * this.volumes.musicVolume > 0;
  }

  private syncMusic(primeOnUnlock = false): void {
    const music = this.music;
    if (!music) return;
    music.volume = this.volumes.masterVolume * this.volumes.musicVolume;
    const shouldPlay = this.shouldPlayMusic();
    // Safari needs play() in the gesture itself, before an async fullscreen grant.
    // Prime once in silence; menu activation can reuse the same pending request.
    const prime = primeOnUnlock && !this.mediaUnlocked && this.unlocked && this.visible && !this.muted && !this.disposed && music.volume > 0;
    // Also silence a play() request which is still settling when a menu closes.
    music.muted = !shouldPlay;
    if (!shouldPlay && !prime) {
      music.pause();
      return;
    }
    if (this.playPending || !music.paused) return;

    const revision = this.revision;
    this.playPending = true;
    try {
      void Promise.resolve(music.play()).then(() => {
        this.playPending = false;
        this.mediaUnlocked = true;
        if (!this.shouldPlayMusic()) music.pause();
        else if (revision !== this.revision) this.syncMusic();
      }, () => {
        this.playPending = false;
        // Retry only if intent changed during the request, never in a rejection loop.
        if (revision !== this.revision && this.shouldPlayMusic()) this.syncMusic();
      });
    } catch { this.playPending = false; }
  }

  private syncUiVolume(): void {
    if (this.master) this.master.gain.value = this.muted || !this.visible || this.disposed ? 0 :
      UI_VOLUME * this.volumes.masterVolume * this.volumes.uiVolume;
  }

  private canPlayUi(): boolean {
    return this.unlocked && !this.disposed && !this.muted && this.visible && this.context?.state === 'running' &&
      this.volumes.masterVolume * this.volumes.uiVolume > 0;
  }

  playHover(): void {
    if (!this.canPlayUi()) return;
    const time = this.context!.currentTime;
    if (time - this.lastHover < HOVER_INTERVAL) return;
    this.lastHover = time;
    this.tone(640, 800, 0.055, 0.12, 'sine');
  }

  playClick(): void {
    if (!this.canPlayUi()) return;
    this.tone(440, 640, 0.095, 0.16, 'triangle');
  }

  private tone(frequency: number, end: number, duration: number, volume: number, type: OscillatorType): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    let tone: Tone | null = null;
    try {
      tone = { oscillator: context.createOscillator(), gain: context.createGain() };
      const { oscillator, gain } = tone;
      const time = context.currentTime;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, time);
      oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(volume, time + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration - 0.005);
      gain.gain.linearRampToValueAtTime(0, time + duration);
      oscillator.connect(gain);
      gain.connect(master);
      this.tones.add(tone);
      const activeTone = tone;
      oscillator.onended = () => this.disconnectTone(activeTone);
      oscillator.start(time);
      oscillator.stop(time + duration);
    } catch {
      if (tone) this.disconnectTone(tone);
    }
  }

  private disconnectTone(tone: Tone): void {
    tone.oscillator.onended = null;
    tone.oscillator.disconnect();
    tone.gain.disconnect();
    this.tones.delete(tone);
  }

  private closeContext(context: AudioContext): void {
    try { void context.close().catch(() => {}); } catch { /* Already closed or unavailable. */ }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.syncUiVolume();
    if (this.music) {
      this.music.muted = true;
      this.music.pause();
      this.music.removeAttribute('src');
      this.music.load();
      this.music = null;
    }
    for (const tone of this.tones) {
      try { tone.oscillator.stop(); } catch { /* A completed tone may already be stopped. */ }
      this.disconnectTone(tone);
    }
    this.master?.disconnect();
    if (this.context) this.closeContext(this.context);
    this.context = null;
    this.master = null;
  }
}
