/** Quiet local fallback while recorded Foley loads, plus an original jet-air loop. */
export type WeaponSoundId = 'pistol' | 'revolver' | 'ak47' | 'm416' | 'uzi' | 'ump' | 'sniper';
export type SyntheticSound = 'rifle' | 'footstep' | 'land' | 'remove' | 'insert' | 'rack' | 'impact' | 'jet'
  | `shot-${WeaponSoundId}` | `reload-${WeaponSoundId}-${'remove' | 'insert' | 'rack'}`
  | 'dry' | 'punch-swing' | 'punch-hit' | 'impact-rock' | 'impact-wood' | 'impact-body'
  | 'kill' | 'pickup' | 'sniper-pickup' | 'drop-warning' | 'heartbeat';

const SHOT_PROFILES: Record<WeaponSoundId, { duration: number; body: number; crack: number; decay: number; ring: number }> = {
  pistol: { duration: .19, body: 170, crack: .63, decay: 43, ring: 2100 },
  revolver: { duration: .35, body: 83, crack: .8, decay: 22, ring: 1550 },
  ak47: { duration: .32, body: 96, crack: .78, decay: 27, ring: 1300 },
  m416: { duration: .25, body: 138, crack: .68, decay: 36, ring: 2650 },
  uzi: { duration: .13, body: 210, crack: .58, decay: 64, ring: 3100 },
  ump: { duration: .21, body: 120, crack: .7, decay: 40, ring: 1700 },
  sniper: { duration: .65, body: 62, crack: .9, decay: 15, ring: 900 },
};
export const WEAPON_SOUND_IDS = Object.keys(SHOT_PROFILES) as WeaponSoundId[];
export function weaponSoundId(value: unknown): WeaponSoundId | undefined {
  return typeof value === 'string' && Object.hasOwn(SHOT_PROFILES, value) ? value as WeaponSoundId : undefined;
}

export function createSyntheticBuffer(context: AudioContext, sound: SyntheticSound): AudioBuffer {
  const weapon = sound.startsWith('shot-') ? SHOT_PROFILES[sound.slice(5) as WeaponSoundId] : undefined;
  const handling = sound.startsWith('reload-') ? sound.split('-') : null;
  const duration = weapon?.duration ?? (handling ? (handling[2] === 'rack' ? .22 : .14) :
    ({ rifle: .28, footstep: .12, land: .17, remove: .14, insert: .12, rack: .22, impact: .16, jet: 2,
      dry: .06, 'punch-swing': .13, 'punch-hit': .18, 'impact-rock': .14, 'impact-wood': .13, 'impact-body': .1,
      kill: .24, pickup: .19, 'sniper-pickup': .42, 'drop-warning': .45, heartbeat: .36 } as Partial<Record<SyntheticSound, number>>)[sound]) ?? .2;
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate);
  const data = buffer.getChannelData(0);
  let seed = Array.from(sound).reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619), 0x45d9f3b), low = 0, bootLow = 0, bootSub = 0;
  const bootLowMix = 1 - Math.exp(-2 * Math.PI * 680 / sampleRate);
  const bootSubMix = 1 - Math.exp(-2 * Math.PI * 90 / sampleRate);
  const noise = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 0xffffffff * 2 - 1;
  };
  // Extra samples let the loop's start crossfade from its own continuation.
  const overlap = sound === 'jet' ? Math.round(0.05 * sampleRate) : 0;
  const working = new Float32Array(data.length + overlap);
  for (let i = 0; i < working.length; i++) {
    const time = i / sampleRate, white = noise();
    low = low * 0.96 + white * 0.04;
    let value: number;
    if (sound === 'jet') {
      const engine = Math.sin(time * Math.PI * 88) * 0.055 + Math.sin(time * Math.PI * 176) * 0.018;
      value = white * 0.24 + low * 1.8 + engine;
    } else if (weapon) {
      const attack = white * Math.exp(-time * (weapon.decay * 2.3));
      const body = Math.sin(2 * Math.PI * (weapon.body * time + 1.8 * (1 - Math.exp(-time * 45)))) * Math.exp(-time * weapon.decay);
      const bolt = Math.sin(time * Math.PI * weapon.ring) * Math.exp(-Math.max(0, time - .025) * 95) * (time > .025 ? .07 : 0);
      const tail = low * Math.exp(-time * weapon.decay * .48) * 1.2;
      value = attack * weapon.crack + body * .38 + tail + bolt;
    } else if (sound === 'heartbeat') {
      const pulse = (start: number, gain: number) => time < start ? 0 :
        Math.sin((time - start) * Math.PI * 116) * Math.exp(-(time - start) * 32) * gain;
      value = pulse(.015, .65) + pulse(.16, .4);
    } else if (['kill', 'pickup', 'sniper-pickup', 'drop-warning'].includes(sound)) {
      const first = sound === 'drop-warning' ? 440 : sound === 'kill' ? 880 : 660;
      const change = sound === 'sniper-pickup' ? .13 : .08;
      const step = Math.floor(time / change);
      const frequency = first * (sound === 'drop-warning' ? (step % 2 ? .75 : 1) : [1, 1.25, 1.5, 2][Math.min(3, step)]);
      const envelope = Math.exp(-(time % change) * 32) * Math.exp(-time * 4);
      value = Math.sin(time * Math.PI * 2 * frequency) * envelope * .35;
    } else if (sound === 'punch-swing') {
      value = low * Math.sin(time / duration * Math.PI) ** 2 * 1.1;
    } else if (sound === 'punch-hit' || sound === 'impact-body') {
      value = low * Math.exp(-time * 38) * 2 + white * Math.exp(-time * 90) * .23;
    } else if (sound === 'impact-wood' || sound === 'impact-rock') {
      const wooden = sound === 'impact-wood';
      value = low * Math.exp(-time * 42) * (wooden ? 2.2 : 1) + white * Math.exp(-time * 90) * (wooden ? .2 : .65);
    } else if (sound === 'dry') {
      value = white * Math.exp(-time * 175) * .43 + Math.sin(time * 24000) * Math.exp(-time * 220) * .12;
    } else if (sound === 'rifle') {
      const crack = white * Math.exp(-time * 75);
      const body = Math.sin(2 * Math.PI * (105 * time + 2.8 * (1 - Math.exp(-time * 40)))) * Math.exp(-time * 30);
      value = crack * 0.72 + low * Math.exp(-time * 14) * 1.1 + body * 0.32;
    } else if (sound === 'land') {
      // Broad, nonperiodic boot pressure with two close contacts and a dry scuff.
      // No oscillator or pitch sweep: the fallback should not sound elastic.
      bootLow += (white - bootLow) * bootLowMix;
      bootSub += (bootLow - bootSub) * bootSubMix;
      const contact = (start: number, decay: number) => time < start ? 0
        : Math.min(1, (time - start) / 0.0015) * Math.exp(-(time - start) * decay);
      const boots = contact(0, 58) + contact(0.024, 68) * 0.62;
      const grit = contact(0.006, 75) + contact(0.03, 90) * 0.42;
      const gear = contact(0.043, 110) * 0.045;
      value = (bootLow - bootSub) * boots * 1.65 + white * (grit * 0.21 + gear);
    } else if (sound === 'footstep') {
      const body = Math.sin(time * Math.PI * 175) * Math.exp(-time * 55);
      value = body * 0.55 + low * Math.exp(-time * 35) * 1.8 + white * Math.exp(-time * 60) * 0.12;
    } else {
      const rack = sound === 'rack' || handling?.[2] === 'rack';
      const transient = Math.exp(-time * 105) + (rack && time > 0.08 ? Math.exp(-(time - 0.08) * 120) * 0.85 : 0);
      const tint = handling ? SHOT_PROFILES[handling[1] as WeaponSoundId].body / 140 : 1;
      const ring = Math.sin(time * Math.PI * 2750 * tint) + Math.sin(time * Math.PI * 4210 * tint) * 0.35;
      value = white * transient * 0.5 + ring * transient * 0.14 + low * Math.exp(-time * (rack ? 16 : 50)) * 0.8;
    }
    if (sound !== 'jet') value *= Math.min(1, time / 0.0015) * Math.min(1, Math.max(0, (duration - time) / 0.012));
    working[i] = Math.max(-0.95, Math.min(0.95, value));
  }
  data.set(working.subarray(0, data.length));
  for (let i = 0; i < overlap; i++) {
    const mix = i / overlap;
    data[i] = working[data.length + i] * (1 - mix) + working[i] * mix;
  }
  return buffer;
}

export const DANCE_BPM = 112;
export const DANCE_BEATS = 16;

/** Original dhol-inspired low/high drum conversation with a short plucked motif. No samples or network. */
export function createDanceBuffer(context: AudioContext): AudioBuffer {
  const rate = context.sampleRate, beat = 60 / DANCE_BPM, duration = DANCE_BEATS * beat;
  const buffer = context.createBuffer(1, Math.round(duration * rate), rate), samples = buffer.getChannelData(0);
  let seed = 71683;
  const add = (at: number, kind: 'low' | 'high' | 'tick' | 'pluck', gain: number, frequency = 220) => {
    const start = Math.round(at * rate), length = Math.round((kind === 'low' ? .28 : kind === 'pluck' ? .3 : .12) * rate);
    for (let i = 0; i < length; i++) {
      const time = i / rate;
      seed = Math.imul(seed, 1664525) + 1013904223 | 0;
      const noise = (seed >>> 0) / 0xffffffff * 2 - 1;
      const attack = Math.min(1, time / .003), end = Math.min(1, (length - i) / (rate * .02));
      const value = kind === 'low' ? Math.sin(2 * Math.PI * (79 * time + .8 * (1 - Math.exp(-time * 50)))) * Math.exp(-time * 17) + noise * .12 * Math.exp(-time * 70)
        : kind === 'high' ? (Math.sin(2 * Math.PI * 235 * time) * .7 + noise * .4) * Math.exp(-time * 38)
          : kind === 'tick' ? noise * .3 * Math.exp(-time * 90)
            : (Math.sin(2 * Math.PI * frequency * time) + Math.sin(4 * Math.PI * frequency * time) * .3) * Math.exp(-time * 19);
      samples[(start + i) % samples.length] += value * gain * attack * end;
    }
  };
  for (let measure = 0; measure < 4; measure++) {
    const origin = measure * 4;
    for (const offset of [0, 1.5, 2, 3.5]) add((origin + offset) * beat, 'low', offset === 0 ? .7 : .5);
    for (const offset of [.5, 1, 2.5, 3, 3.75]) add((origin + offset) * beat, 'high', offset === 3.75 ? .28 : .42);
    for (let tick = 0; tick < 8; tick++) add((origin + tick * .5) * beat, 'tick', .2);
    add((origin + .75) * beat, 'pluck', .12, [220, 261.63, 293.66, 261.63][measure]);
    add((origin + 2.75) * beat, 'pluck', .1, [329.63, 293.66, 261.63, 220][measure]);
  }
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i] * .8) * .75;
  return buffer;
}
