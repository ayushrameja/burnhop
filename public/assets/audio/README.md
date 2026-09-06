# Midnight Hangar

The current entry and main menu use an original synthesized percussion loop from `src/game/audioSynthesis.ts`: 16 beats at 112 BPM, with low/high drum responses and a short plucked motif inspired by Punjabi dance rhythms. It contains no third-party samples, vocals, or runtime network dependencies. `MenuAudio` starts it only after a user gesture, retains its playhead between entry and menu, and stops it during gameplay or when hidden/muted. The quiet default music level is 10%.

The older Midnight Hangar asset below remains available for the optional legacy music path; it is not layered over the active percussion loop.

- File: `midnight-hangar.mp3` (stereo, 44.1 kHz, approximately 3:05)
- Created with SoundBreak's Wes Bailey AI cowriter on 2026-09-05 for Burnhop.
- Track: https://app.soundbreak.ai/listen/236f1c25
- Generation: `fb1737a8edabe3805ca9cf5a18e33de3`
- Direction: original instrumental lo-fi hip-hop; warm piano/Rhodes chords, soft swung drums, mellow bass, a restrained repeating motif, and a moonlit desert/hangar mood. No vocals or combat effects.

The generated MP3 is bundled locally, with no runtime API or account requirement. `src/game/menuAudio.ts` sets the music's repeat behavior and adjustable volume (10% by default). Hover and click cues are original Web Audio synth tones in that module; gameplay effects remain in `src/game/audio.ts`.
