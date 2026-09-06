# Recorded weapon audio — 2026-09-06

All seven weapon loadouts now use three recorded firing takes, three recorded mechanical reload stages and a recorded dry-fire click. Previously, normal weapon events bypassed the existing recordings and always used synthesized cues. The new 43-clip set totals 1,331,772 bytes. Source models, substitutions, CC0 credits and exact reproducible cuts are documented in [the asset README](../public/assets/audio/sfx/weapons/README.md).

`src/game/weaponAudio.ts` declares the recordings and mix levels. Gunfire rotates separate discharges with only ±0.5% playback-rate and ±2% gain variation. Remote weapon sounds lose treble with distance in addition to existing panning and attenuation. The 24-voice budget, four reserved local slots, category settings and output compressor remain in use. Missing or undecodable assets fall back to local broadband pressure/mechanical synthesis without the former pitched shot sweep.

Reloads follow the existing simulation/animation stage thresholds, 0.20/0.55/0.82. Each physical weapon tracks consumed stages independently. Pause cuts live audio; practice retains its frozen cue history and online progress observed during pause is consumed silently. Cancellation, equipment changes and actor removal stop active handling voices. Stage masks prevent small backward prediction corrections from repeating clicks. Explicit reload-start events reset the cycle even if an inactive state patch is skipped; a pending baseline also handles start events arriving before the corresponding state patch.

## Verification

- **459 tests passed across 40 files**, including the real local WebSocket backend suite. Audio tests cover recorded identities, all seven guns, loading transitions, fetch/HTTP/decode failures, reload cancellation, sequential dual reloads, pause, event-before-patch ordering, small rollback corrections, voice limits, panning and distant filtering.
- **17 Chromium browser scenarios passed** on an isolated preview at port 5191, including all seven loadouts firing three distinct takes and their complete reloads through actual UI controls. Additional checks cover mixed pistol/Uzi dual reloads, pause mid-reload, blocked recordings, volume persistence, existing menu music and movement audio.
- Browser instrumentation observes native decoded `AudioBuffer` identities and actual source starts. Procedural audio is not misidentified as a recording based on duration. Headless pointer/fullscreen capture uses the project's existing fixture; Web Audio playback remains native.
- **Client/server TypeScript checks and production build passed.** Every production WAV matches the corresponding source asset byte for byte.
- Every WAV is PCM16 mono 44.1 kHz, non-silent, with peak at or below 0.82 and zero-valued endpoints. Each weapon has three different discharge waveforms. Regeneration into a temporary directory reproduces all 43 files byte for byte.
- The sniper reload screenshot was inspected: the weapon reload animation and HUD remain visible, with no added interface obscuring gameplay. Screenshot: `test-results-weapon-audio/gameplay-audio-sniper-uses-c99a0-rough-real-loadout-controls-chromium/recorded-weapon-reload.png`.

The before/after listening reel presents pistol, AK-47 and sniper in that order, eight seconds per weapon: previous synthesized shots, then current recordings and reload Foley. It uses per-voice gain but omits the full runtime compressor and other game sounds. Automated signal and playback checks do not establish subjective realism on every speaker or headset. Safari and a separate live multiplayer listening session were not run.

Work was performed only in `jetpack-prototype` on `main`. The separate `jetpack-five-maps` checkout and its active task were not modified or interrupted. Existing unrelated changes in the main checkout were preserved.

## Follow-up: handgun grips, Q pairing and magnum sniper report

The named-weapon drawing path omitted the foreground trigger hand. It now paints the fingers over the grip, places pistol/revolver support palms around the handle, and paints the offhand weapon over the jacket. Each hand uses the corresponding weapon angle during dual reloads. A 12-pose render sheet was inspected across both facings, upward/downward aim, mixed handguns and crouch.

Revolvers now join pistols and SMGs as pairable weapons in the shared catalog. Practice Q displays an explanation when either weapon is incompatible or no station is in reach. Browser checks walk to the revolver station, equip with F, pair with Q, verify both ammo counts decrease on firing, and reload both magazines. Multiplayer pickup tests also cover two distinct revolver instances. The compatibility fingerprint includes the changed catalog.

The three sniper recordings now have 1.55-second magnum-style reports, with stronger recorded low pressure, a brief crack layer, and irregular filtered outdoor reflections. The final asset set is 1,535,514 bytes; only the three sniper WAVs changed. Exact processing and limits are in the asset README and regeneration script. The comparison clip plays the earlier sniper once, then the revised sniper twice; it is a listening aid rather than a claim of an exact PUBG AWM reproduction.

Validation: **464 unit/backend tests passed**, client/server types and final production build passed, and all **20 relevant browser scenarios passed across the initial and targeted runs**. The first browser run found one stale E/F-default assertion; its corrected F/Q/E expectation and actual remapping check passed on rerun. The final sniper asset edit separately passed the shipped-WAV integrity checks. Browser audio uses actual decoded files and native source starts. Subjective headset listening remains the user's final comparison.
