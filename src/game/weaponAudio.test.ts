import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEAPON_AUDIO_SAMPLES } from './weaponAudio';
import { WEAPON_SOUND_IDS } from './audioSynthesis';

/** Inspect the actual shipped audio so a missing, silent or clipped replacement
 * cannot pass only because a mocked decoder accepted its filename. */
function readWave(name: string) {
  const bytes = readFileSync(new URL(`../../public/assets/audio/sfx/${name}.wav`, import.meta.url));
  expect(bytes.toString('ascii', 0, 4), name).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12), name).toBe('WAVE');
  let rate = 0, samples = new Float32Array();
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4), chunk = bytes.toString('ascii', offset, offset + 4);
    expect(offset + 8 + size, name).toBeLessThanOrEqual(bytes.length);
    if (chunk === 'fmt ') {
      expect(bytes.readUInt16LE(offset + 8), name).toBe(1);
      expect(bytes.readUInt16LE(offset + 10), name).toBe(1);
      rate = bytes.readUInt32LE(offset + 12);
      expect(bytes.readUInt16LE(offset + 22), name).toBe(16);
    }
    if (chunk === 'data') samples = Float32Array.from({ length: size / 2 }, (_, i) => bytes.readInt16LE(offset + 8 + i * 2) / 32768);
    offset += 8 + size + size % 2;
  }
  return { bytes, rate, samples };
}

describe('shipped weapon recording integrity', () => {
  it('ships every firing take, reload stage and dry-fire cue as short, non-silent PCM with headroom', () => {
    expect(WEAPON_AUDIO_SAMPLES).toHaveLength(43);
    expect(new Set(WEAPON_AUDIO_SAMPLES).size).toBe(43);
    let totalBytes = 0;
    for (const name of WEAPON_AUDIO_SAMPLES) {
      const { bytes, rate, samples } = readWave(name);
      totalBytes += bytes.length;
      expect(rate, name).toBe(44100);
      expect(samples.length / rate, name).toBeGreaterThan(.02);
      expect(samples.length / rate, name).toBeLessThan(2);
      let peak = 0, energy = 0;
      for (const sample of samples) { peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
      expect(peak, name).toBeLessThan(.96);
      expect(Math.sqrt(energy / samples.length), name).toBeGreaterThan(.005);
      expect(Math.abs(samples[0]), name).toBeLessThan(.002);
      expect(Math.abs(samples.at(-1)!), name).toBeLessThan(.002);
    }
    expect(totalBytes).toBeLessThan(8 * 1024 * 1024);
  });

  it('provides three different recorded waveforms for every weapon', () => {
    for (const weapon of WEAPON_SOUND_IDS) {
      const signatures = [1, 2, 3].map(take => {
        const { samples } = readWave(`weapons/shot-${weapon}-${take}`);
        return createHash('sha256').update(new Uint8Array(samples.buffer)).digest('hex');
      });
      expect(new Set(signatures).size, weapon).toBe(3);
    }
  });
});
