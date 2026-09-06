# Gameplay sound effects

Weapon firing, reload stages and dry fire now use locally hosted recordings. All seven guns have three shot takes and their own edited handling cues in [`weapons/`](weapons/README.md); that file documents source recordings, model substitutions, licensing and regeneration. The shot and reload synthesis in `src/game/audioSynthesis.ts` is an offline/loading fallback, using broadband pressure and short mechanical noise instead of pitched shot sweeps. Punches, body/wood/rock impacts, kill/pickup/drop feedback and heartbeat remain synthesized. The existing movement and metal recordings below remain in use, and the old rifle/reload files support legacy callers.

Gameplay uses a maximum of 24 voices, reserves four slots for local sounds, prioritizes confirmation cues over distant tails, and applies stereo position, distance attenuation and a low-pass filter to remote weapon sounds. Feedback has a separate volume control, and the heartbeat can be disabled independently.

These short, locally hosted WAV files use CC0 source recordings. No account, streaming service, or third-party runtime request is required. The original creator pages were checked on 2026-09-05.

| Shipped files | Creator and source | Source file / edit |
| --- | --- | --- |
| `rifle-1.wav`, `rifle-2.wav`, `rifle-3.wav` | [Tabasco — Gunshot Sounds](https://opengameart.org/content/gunshot-sounds), CC0 | `sounds.zip` → `sks.wav`. Three separate SKS shots, starting at 0.343s, 3.329s and 5.994s; each trimmed to 0.370s. |
| `reload-remove.wav`, `reload-insert.wav`, `reload-rack.wav` | [SpringySpringo — Gun reload sounds](https://opengameart.org/content/gun-reload-sounds), CC0 | `assaultriflereload1_0.wav`, an airsoft rifle recording. Extracted at 0.222s / 0.185s duration; 1.022s / 0.166s; 1.197s / 0.320s respectively. |
| `footstep-1.wav` through `footstep-4.wav` | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds), CC0 | `Audio/footstep_concrete_000.ogg` through `003.ogg`. |
| `land.wav` | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) and [SpringySpringo — Gun reload sounds](https://opengameart.org/content/gun-reload-sounds), CC0 | Original 0.170s composite of the shipped concrete footsteps 3, 4 and 2, with a quiet 55ms gear tick taken from the shipped `reload-remove.wav`. See the landing recipe below. |
| `impact-metal.wav` | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds), CC0 | `Audio/impactMetal_light_000.ogg`, trimmed to 0.349s. |

License: [Creative Commons CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required by these sources; the credits above are retained for provenance. These recordings may be used and modified, including in commercial games.

All clips use 44.1 kHz mono, signed 16-bit PCM WAV. The rifle clips were high-passed at 100 Hz, low-passed at 9 kHz, and processed with FFmpeg `afftdn=nf=-35:nr=18` to reduce ambient noise before trimming. Reload clips use 130 Hz / 8.5 kHz filtering; footsteps use 70 Hz / 6 kHz; the metal impact uses 65 Hz / 7.5 kHz. These source clips have a 1 ms opening fade and a final 55 ms fade, with peak normalization to 0.8 (rifle/metal impact) or 0.85 (footsteps/reload), leaving headroom. The composed landing uses the separate processing below.

Runtime mixing is in `src/game/audio.ts`, with the weapon asset manifest and per-gun mix in `src/game/weaponAudio.ts`. Three recorded takes rotate for each weapon with at most 0.5% pitch and 2% level variation. Four footstep variations retain their existing treatment. Recordings preload once after the gameplay audio unlock gesture; no streaming service or external runtime request is needed. Compact original synthesized fallbacks keep events audible while clips load or if fetching/decoding fails. The jet sound is a crossfaded loop of filtered air, low-frequency turbulence, and subdued engine harmonics.

Reload sounds fire at simulation progress 0.20 (remove), 0.55 (insert), and 0.82 (rack), shared with the animation timeline in `src/game/reload.ts`. They do not use wall-clock timers. Each weapon instance has its own stage ledger, including sequential dual reloads. Small backward network corrections cannot repeat completed stages. Pause stops live sources; frozen practice resumes its timeline, while online progress observed during pause is consumed silently. Canceling, unequipping or removing an actor stops that weapon's remaining handling sounds. Footsteps follow actual grounded distance, and landing intensity follows the preceding vertical impact speed.

## Dry landing cue

The earlier `impactSoft_heavy_000.ogg` landing and its slowed playback have been replaced. The current cue combines two close boot strikes, a small amount of low boot pressure, and a quiet equipment tick. It has no added oscillator, reverb, pitch sweep, or slowed playback. The short contacts remain at their recorded pitch for light and heavy falls; the preceding downward speed controls only the cue's gain. The runtime plays one composed landing voice, without adding another separate footstep on top.

The composite uses these already credited files, so regeneration does not require another download:

| Layer | Processing | Mix gain | Start offset |
| --- | --- | --- | --- |
| `footstep-3.wav` | High-pass 140 Hz; low-pass 6500 Hz | 0.95 | 0 ms |
| `footstep-4.wav` | High-pass 190 Hz; low-pass 5000 Hz | 0.80 | 19 ms |
| `footstep-2.wav` | High-pass 120 Hz; low-pass 550 Hz | 0.25 | 6 ms |
| `reload-remove.wav`, 50–105 ms | High-pass 1000 Hz; low-pass 5000 Hz; 2 ms fade in; final 20 ms fade out | 0.13 | 32 ms |

The layers were mixed with FFmpeg `amix=inputs=4:normalize=0`, padded/trimmed to 170 ms, faded in over 0.8 ms and out from 130–170 ms, and exported as float PCM for finishing. Finishing subtracts the DC mean, tapers the first and last 5 ms to zero, normalizes the final peak to 0.78, and exports signed 16-bit PCM. Sources retain their original timing and pitch. The finished file has a peak of approximately 0.780 and RMS of 0.087.

If the landing recording has not loaded or cannot decode, its local fallback uses two filtered noise contacts plus short broadband scuff/gear noise. It contains no sinusoidal body.

`src/game/audio.test.ts` checks impact gain scaling without pitch changes or duplicate footfalls, fallback routing and pause behavior, the shipped WAV's format/headroom/quiet tail, and low-frequency waveform periodicity. The synthetic cue is checked at 22.05, 44.1 and 48 kHz. These signal checks catch ringing and lifecycle regressions; listening in the complete game mix remains the final subjective sound check.
