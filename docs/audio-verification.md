# Audio and reload verification — 2026-09-05

Menu music defaults to **10%**. Settings → Audio provides saved 0–100% master, music, weapons/reload, movement/jetpack and menu-effect levels, plus a master sound toggle and audio-only reset. Motion has a separate tab. Existing v3 saves gain defaults without losing appearance, controls or mute.

## Results

- **224 unit tests passed**, including audio lifecycle, channel gain, sample loading/fallback, footstep cadence/landing strength, reload cue timing, cleanup, settings normalization and articulated reload geometry.
- **TypeScript and production build passed**, with the music and all 12 short WAV effects included.
- **26 browser scenarios passed** across audio, gameplay audio, game entry, practice and settings. The main isolated run passed 25; the remaining movement check passed after correcting its assertion to distinguish the single jump push-off from repeated airborne footsteps. Production audio did not change for that correction.
- Browser checks observe native HTML media/Web Audio playback. They verify the actual music loop, live slider gains, category mute independence, saved settings, recorded shots and footsteps, and a reload paused longer than its full duration before resuming without replaying completed cues.
- The hand/magazine sequence was reviewed at seven phases, standing right, crouched left and aiming up with reduced motion. See `screenshots/audio-upgrade/reload-phases.png`. Desktop and 390px Audio layouts were also reviewed.

## Audio assets

`midnight-hangar.mp3` is SoundBreak’s original stereo lo-fi track (185.47 seconds), served locally. The short effects use documented CC0 recordings with three rifle variants, four concrete footsteps, three mechanical reload stages and two impacts. See `public/assets/audio/sfx/README.md` for creator links, licensing and processing. WAV clips decode correctly and have peaks below full scale; gameplay uses conservative per-voice gains and a compressor to control overlapping shots. Jet audio is a filtered air/engine loop; synthesized fallback buffers cover missing samples.

## Scope of checks

The project’s existing fullscreen/pointer-lock fixtures are used because native pointer lock is unavailable in this host’s headless Chromium. Audio playback is native. Concurrent arena-selection edits refreshed the live development server during early checks, so the final pass ran on a temporary source copy at port 5187. Audio/animation code and App/runtime/renderer integration matched the workspace at completion. The temporary check server exited after testing. Safari was not run.

The existing settings focus check now waits for the remapped binding’s scheduled focus restoration before testing focus containment. No production focus behavior was changed.
