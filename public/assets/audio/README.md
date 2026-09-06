# Menu music

Two original SoundBreak songs are bundled locally. Runtime playback needs no external service or account. Both MP3s are stereo at 44.1 kHz and decode without errors.

| Screen | Asset | Duration | Direction / animation tempo | SoundBreak track |
| --- | --- | --- | --- | --- |
| Enter game | `moonwalk-at-sundown.mp3` | 174.37 s | Feel-good instrumental lo-fi; 84 BPM brief; moonwalk | https://app.soundbreak.ai/listen/af4d50ad |
| Lobby / menus | `hangar-bhangra.mp3` | 158.23 s | Punjabi bhangra lo-fi with sparse vocal hooks; 96 BPM brief; energetic bhangra | https://app.soundbreak.ai/listen/5f35c4d9 |

Created September 6, 2026 with SoundBreak's Wes Bailey (entry) and Zac Samuel (lobby) cowriters. Generation IDs: entry `56f364c5f840b96a30ebeadcd78a4daa`, lobby `cf21e0fe6a498a8fb7a3353a859491ef`. The second lobby version remains in SoundBreak: https://app.soundbreak.ai/listen/2832f44f.

The entrance brief requested warm Rhodes/piano seventh chords, mellow bass, dusty swung hip-hop drums, a restrained playful melody and smooth gliding energy. The lobby brief requested double-time dhol accents, tumbi riffs, warm Rhodes, rounded bass and short original Punjabi hooks about friends coming together to play, with generous instrumental passages. Both requested a consistent groove and matching opening/ending harmony. Tempos in `src/game/menuMusic.ts` are the requested tempos, not measured beat grids.

`MenuAudio` uses one looping media player and changes its source when the screen changes. It starts only after a user gesture, defaults to 10% music volume, and respects mute, channel sliders, visibility and gameplay. Navigation within the lobby retains playback; changing between entry and lobby starts the selected song from the beginning. The animation follows media time while audible and a local presentation clock while silent. Reduced motion keeps a static pose.

The older `midnight-hangar.mp3` (https://app.soundbreak.ai/listen/236f1c25) and original synthesized dance buffer remain as legacy assets/code; the app selects the two new files through `menuMusic.ts`. Hover/click synth cues and gameplay effects are unchanged.
