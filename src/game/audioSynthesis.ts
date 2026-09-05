/** Quiet local fallback while recorded Foley loads, plus an original jet-air loop. */
export type SyntheticSound = 'rifle' | 'footstep' | 'land' | 'remove' | 'insert' | 'rack' | 'impact' | 'jet';

export function createSyntheticBuffer(context: AudioContext, sound: SyntheticSound): AudioBuffer {
  const duration = { rifle: 0.28, footstep: 0.12, land: 0.17, remove: 0.14, insert: 0.12, rack: 0.22, impact: 0.16, jet: 2 }[sound];
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x45d9f3b + sound.length * 313, low = 0, bootLow = 0, bootSub = 0;
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
      const rack = sound === 'rack';
      const transient = Math.exp(-time * 105) + (rack && time > 0.08 ? Math.exp(-(time - 0.08) * 120) * 0.85 : 0);
      const ring = Math.sin(time * Math.PI * 2750) + Math.sin(time * Math.PI * 4210) * 0.35;
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
