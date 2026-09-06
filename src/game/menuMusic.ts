/** Original SoundBreak tracks bundled locally; tempos match the generation briefs. */
export const MENU_MUSIC = {
  entry: { file: 'moonwalk-at-sundown.mp3', bpm: 84 },
  lobby: { file: 'hangar-bhangra.mp3', bpm: 96 },
};
export type MenuMusicScene = keyof typeof MENU_MUSIC;
