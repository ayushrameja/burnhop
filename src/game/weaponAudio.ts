import { WEAPON_SOUND_IDS, type WeaponSoundId } from './audioSynthesis';

export type ReloadStage = 'remove' | 'insert' | 'rack';
export type ShotTake = 1 | 2 | 3;
export type WeaponAudioSample = `weapons/shot-${WeaponSoundId}-${ShotTake}`
  | `weapons/reload-${WeaponSoundId}-${ReloadStage}` | 'weapons/dry-fire';

/** The browser only downloads the edited, local clips, never the source library. */
export const WEAPON_AUDIO_SAMPLES: readonly WeaponAudioSample[] = [
  ...WEAPON_SOUND_IDS.flatMap(id => [
    ...([1, 2, 3] as const).map(take => `weapons/shot-${id}-${take}` as const),
    ...(['remove', 'insert', 'rack'] as const).map(stage => `weapons/reload-${id}-${stage}` as const),
  ]),
  'weapons/dry-fire',
];

/** Recorded takes provide the character; tiny variations avoid mechanical repetition. */
export const WEAPON_AUDIO_MIX: Readonly<Record<WeaponSoundId, { shot: number; reload: number }>> = {
  pistol: { shot: .76, reload: .58 },
  revolver: { shot: .88, reload: .62 },
  ak47: { shot: .79, reload: .63 },
  m416: { shot: .75, reload: .6 },
  uzi: { shot: .65, reload: .54 },
  ump: { shot: .72, reload: .59 },
  sniper: { shot: .94, reload: .65 },
};
