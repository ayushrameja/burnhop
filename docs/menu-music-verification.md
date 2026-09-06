# Menu music and choreography — September 6, 2026

- Enter game: bundled SoundBreak lo-fi instrumental, relaxed unarmed moonwalk with alternating heel lifts and backward glides.
- Lobby: bundled Punjabi bhangra lo-fi song, raised-arm accents, stronger hops and alternating knee lifts. Phone framing keeps the dancer below the controls.
- Tracks use one native looping media player. Screen changes replace the source without overlapping tracks; menu navigation keeps playback. Hidden pages, mute, zero music/master volume and gameplay stop the music. Entry remains silent until a user gesture.
- Existing character appearance is preserved. Animation is presentation-only, runs at 30 FPS, stops while hidden, and becomes static with reduced motion.

## Verification

- 49 focused unit tests passed across menu audio, character geometry and detailed character rendering, including pending-playback source switching and mute.
- 7 Chromium scenarios passed: entry/lobby handoff, real MP3 loop wrap, gameplay/pause/visibility, UI cues, persisted mute, live volume sliders, and desktop/mobile animation with reduced motion.
- Reviewed screenshots at 1440px and 390px; the mobile framing was adjusted and the two choreography scenarios rerun.
- TypeScript and production build passed. FFmpeg decoded both complete MP3 files without errors.
- Browser tests use the repository's fullscreen/pointer-lock fixture; media playback is native. Safari was not exercised. The host runs Node 24.4.1, so pnpm reports the repository's Node 22 engine warning.

Track provenance, durations, briefs and alternate lobby take: `public/assets/audio/README.md`. Requested BPM values drive animation; generated-song tempo and Punjabi lyric pronunciation have not been independently reviewed.
