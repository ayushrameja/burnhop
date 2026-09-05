# Verification — September 5, 2026

## Results

| Check | Result |
| --- | --- |
| TypeScript type checking | Passed |
| Vitest simulation, aiming, character, detailed rig, renderer, and capture tests | 103 passed |
| Default Playwright browser scenarios | 24 passed; 1 native capture integration case opt-in |
| Native fullscreen and pointer capture | Verified through Arc desktop UI: entry, aiming/fire, Escape, resume |
| Vite production build | Passed |
| Production browser smoke | Passed, 1440 × 900 at 2× device pixel ratio |
| Production browser errors | None observed |
| External production asset requests | Zero |
| Development diagnostic API in production | Absent |
| Observed idle practice frame rate | Approximately 60 fps, headless Chromium at 1280 × 720 |

Frame metrics are recorded in `browser-metrics.json`. This is an observed single-player browser sample, not a guarantee for other hardware or a 16-player benchmark. `production-smoke.json` records the production check.

## Exercised behaviours

- Real loading held behind an unfinished SVG request; menu inaccessible until loading completed. Asset request failure and successful Retry.
- Menu, live headgear customization, saved settings restored after reload, and transition into Practice.
- Keyboard movement, original held Space remaining a jump, a fresh airborne held press applying thrust, fuel depletion without automatic restart, and regeneration while no thrust is applied.
- Aiming and firing while airborne; target hits, five-hit death, respawn, manual reload, and correct targeting after changing viewport size.
- Blur while moving pauses simulation and clears input. Resume, Escape pause, restart resets ammunition/statistics, and exit removes the runtime.
- Production movement, jump, thrust, fire, pause, and keyboard focus containment at Retina resolution.
- Unit tests additionally cover collision sweeps, platform edges, grounded/coyote behaviour, ceilings, cover and protruding muzzle handling, ammunition/cadence/timers, and identical simulation state across 30/60/144 Hz render schedules.

## Screenshot review and fixes

Reviewed loading, menu, customization, practice, flight, hits, resize, pause, and production screenshots in `screenshots/`.

- Added an overall loading deadline and guarded progress after failure so stalled imports/decodes and retry races cannot leave the interface stuck.
- Kept gameplay keyboard handling away from focused interface controls; restored canvas focus after dismissing the hint.
- Added modal focus containment and consistent accessible button names.
- Moved the menu pilot label and coordinates away from illustration props.
- Added a compact cream backing to session statistics after the taller viewport exposed low contrast against letterboxing.
- Bundled WOFF2 fonts and their OFL licenses locally; production needs no remote font service.

One early flight test tried to aim at a ground target after camera movement placed it outside the viewport; the test now exercises firing toward a visible point in the playfield. This was a test-coordinate issue, not a shooting failure.

## Dark visual update

Replaced the light palette throughout the loading screen, menu, customization, controls, pause, HUD, and Canvas environment. Kept the existing layout and cosmetic colours. The shared `OUTPOST_PALETTE` provides one permanent night palette; CSS declares a dark colour scheme without adding a theme setting.

The production build and all five existing Chromium browser scenarios pass after the change. Refreshed and reviewed the menu, customization, arena, and resized screenshots; inspected the controls dialog in the running production preview and refreshed the user's existing tab. Gameplay simulation and input rules were not changed.

## Burnhop rebrand

Renamed the menu wordmark, loading screen, practice watermark, accessible menu link, browser title/description, package, and development diagnostic API to Burnhop. The menu and loading tagline is “Burn bright. Hop higher.” Preferences saved under the previous storage key are read when Burnhop settings are absent; subsequent saves use `burnhop-settings`.

TypeScript, the production build, all 23 unit tests, all five Chromium scenarios, and the production smoke check passed. The existing persistence scenario also verifies the new page title, accessible brand link, migration of previous cosmetics/sound/motion settings, and precedence of new settings after reload. Refreshed screenshots and visually reviewed the menu and production practice view.

The pnpm command wrapper attempted an automatic dependency reinstall and stopped at its noninteractive purge prompt. Validation used the already-installed local TypeScript, Vite, Vitest, and Playwright binaries directly.

## Movement tuning

Extended continuous jet fuel from 2.5 to 3.5 seconds. Thrust holds at 3600 px/s² for the first 10% of the tank, then tapers linearly to 1800 px/s² at empty; the initial force is stronger than the previous 2600 px/s². Gravity and speed limits remain unchanged, so the curve changes acceleration rather than forcing a velocity reduction. Midpoint fuel sampling and partial final ticks preserve fuel accounting.

Added a nine-tick (150 ms) landing buffer and increased ledge grace from five to eight ticks. A descending Space press probes the collision path for a nearby landing; it queues a fuel-free jump on the landing tick, retaining horizontal velocity. Releasing the key preserves that one queued hop. A held press falls back to thrust if steering misses the predicted landing. Pause clears queued hops.

All 33 unit tests and six Chromium scenarios passed. New coverage includes fuel remaining at 2.5 seconds and depletion at 3.5 seconds, the power curve and initial kick, partial final fuel ticks, released jump buffers, same-tick landing/hop events, preserved horizontal speed, platform-edge steering, buffer expiry, ledge grace, and pause cleanup. The browser chained three early-press hops with fuel remaining at 100%. TypeScript, Vite build, and production smoke passed; the updated flight manual was checked in production. Reviewed the bunny-hop and flight-manual screenshots (`10-bunny-hop.png`, `11-movement-controls.png`). Subjective movement feel still benefits from the player's own playthrough.

## Articulated movement, radial aiming, and jet boots

Default aiming now uses a 14-world-pixel dash beginning 8 pixels beyond the muzzle. It follows the authoritative aim angle around the interpolated weapon pivot. A 6-CSS-pixel center dead zone retains the latest angle. Holding right mouse restores the existing pointer-position crosshair; left firing is independent, including every press/release order. Pause, blur, hidden tabs, cancellation, restart, and teardown clear held mouse intent. Aim mode stays in the browser runtime, with no simulation-command or saved-settings changes.

Both legs now articulate from their hips through moving knees and alternating lifted recovery steps. Ground speed drives cadence; flight and stopping blend between poses. The renderer preserves the last travel direction during a backward stop. Shared boot geometry supplies both flames and particle origins, replacing the backpack. Reduced motion removes decorative bob, flame flutter, and exhaust trails. Movement constants, collision geometry, weapon pivot, jumping, thrust power, and fuel rules remain unchanged.

Verification used the installed local binaries because the pnpm wrapper attempts a dependency reinstall in this environment. TypeScript, all 48 unit tests, five new aiming browser scenarios, six existing practice browser scenarios, the production build, and the production smoke test passed. The aiming scenarios cover full-circle aim, fixed marker geometry, the center dead zone, all mouse-button combinations, lifecycle resets, continued target hits during mode switching, resizing, and following-camera alignment at 2× DPR. Production smoke confirms independent right/left control, no browser errors or external asset requests, and absence of development diagnostics.

Ran `node scripts/review-motion.mjs` against the development server and inspected the resulting gameplay, menu, pause, and enlarged pose screenshots (`12` through `18` in `screenshots/`). Reviewed forward/backward and left-facing stride frames, idle, jump, fall, both thrust facings, and reduced motion. Visual review caught and fixed rounded calf strokes extending below the boot soles. The refreshed frame sheet confirms that boot soles and exhaust origins align. The existing browser suite also exercised landing, bunny hops, customization persistence, and flight while firing. These are automated interaction and visual checks; player preference for the final movement feel remains subjective.

## Extended aim, frame-rate aiming, fullscreen capture, and FPS

The aim dash is now 28 world pixels long and starts 136 pixels from the weapon pivot (two collision-body heights), with its original 2-pixel thickness. Visual aim resolves the latest mouse input every rendered frame against the updated camera and interpolated weapon position. Three renderer tests prove that weapon rotation and marker direction change even when no simulation tick advances, and that the calculation uses the current camera. The fixed 60 Hz simulation and movement/weapon/fuel rules are preserved.

Practice now waits at an explicit entry prompt. Enter fullscreen requests pointer lock before fullscreen within the button gesture and starts only when both are owned. Escape, capture loss, focus loss, and exit release capture and pause. Immersive resume reacquires through another gesture. Partial failures unwind successfully acquired capture and show retry/windowed choices. Captured motion uses a clamped virtual pointer; mouse-button events never replace its position with the browser's frozen cursor coordinates. The bottom-right FPS readout reports a rolling half-second of real rendered frames, refreshing up to four times per second and resetting to unavailable while paused.

TypeScript, the production build, all 64 unit tests, five aiming scenarios, six existing practice scenarios, and four entry/fallback scenarios passed. The production smoke passed with explicit entry, live FPS, independent mouse buttons, and pause cleanup; no browser errors, external asset requests, or production diagnostics were observed. Refreshed and reviewed the entry prompt (`19-capture-ready.png`), larger dash, FPS placement, pointer mode, and pause controls.

The bundled automation Chromium rejected native pointer lock with `WrongDocumentError`, including on an isolated connected canvas with an active user gesture; its headed run also failed acquisition. The unchanged native integration assertions are opt-in with `BURNHOP_NATIVE_CAPTURE=1` rather than reported as passing. A separate desktop-UI playtest in Arc successfully entered fullscreen with capture, aimed and fired, released capture with Escape, and resumed fullscreen successfully. The observed Arc FPS readout was 144 on this machine; this is a sample, not a performance guarantee. The embedded preview's capture attempt was blocked and correctly offered windowed play; its windowed FPS readout and larger dash were also checked.

## Additional aim-line sizing

Doubled the dash again from 28 to 56 world pixels and increased its starting distance by 10%, from 136 to 149.6 world pixels (2.2 character-heights). Thickness remains 2 world pixels. The 17 focused aiming/renderer tests, TypeScript check, and production build passed.

## Crouch design preview

Implemented a separate `/?preview=crouch` screen, reachable from the menu footer, using the existing character renderer and artwork. An explicit optional preview pose has nearly straight standing legs, fixed-length articulated limbs, separated planted boots, and a crouch that lowers the whole upper body and rifle by 17.44 world pixels (about 20%). Normal gameplay omits this pose parameter and retains its existing geometry and weapon origin.

The preview includes enlarged and 1× world-scale comparisons, a depth slider, stance buttons, transition replay, facing flip, and a leg-joint overlay. Reduced motion disables replay and makes stance-button changes immediate. Animation stops when the page is hidden and is cleaned up on exit. Narrow-screen visual review caught misaligned ground baselines caused by wrapping captions; the comparison now preserves equal canvas positions.

Validation: TypeScript and production build passed; all 70 unit tests passed, including six new crouch geometry checks. The 11 existing aiming/practice browser scenarios passed across the initial run and a focused rerun. One existing near/far aim comparison initially failed by 0.00005856 world pixels: Chromium quantizes an input Y of 573.7 to 573.7000122070312, producing slightly different angles at 30 and 100 pixels from the pivot. Relaxed only that visual comparison from four to three decimal places, keeping the analytical geometry assertions and gameplay code unchanged; the focused scenario then passed.

`node scripts/review-crouch.mjs` passed against development and the compiled production bundle, with no browser errors. Reviewed standing/crouching, left-facing joints, intermediate pose, 390px and 320px layouts, and reduced motion. The script also checks slider keyboard interaction, replay completion, menu navigation, reload, and equal comparison baselines. Production verification used `BURNHOP_PREVIEW_URL=http://127.0.0.1:4173`; the browser loaded the generated `/assets/index-DAgxf2aN.js` bundle. Screenshots `20` through `25` record the final poses and layouts; `20-crouch-comparison.png` is the compact comparison.

This pass implements a visual pose study. Crouch input, gameplay collision-height changes, standing clearance, movement, camera, detailed artwork, and head aiming remain later work.

## Aim-driven head and torso movement

The approved crouch now supports independent up/down aim in the preview. The same shared rendering also responds to mouse aim in practice. Torso lean is limited to 6 degrees and total head/helmet pitch to 24 degrees, using normalized facing-relative aim. The neck follows the rotated torso attachment; a two-segment near arm connects the leaning shoulder to the unchanged weapon grip. Hip, belt, legs, soles, exhaust, and weapon origin remain independent of aim.

Added look-direction slider/presets, smooth preset transitions, immediate reduced-motion presets, waist/neck joint guides, and selected-facing preservation at vertical preview endpoints. Preview animation cleanup covers both aim and crouch transitions.

TypeScript and the production build passed. All 77 unit tests passed, including seven new tests for angle limits/wrapping, rigid neck attachment, arm lengths/attachment, neutral-pose preservation, stance invariants, invalid-angle fallback, and reduced motion. All 11 aiming/practice browser scenarios passed together. Reviewed up/down standing and full-crouch silhouettes in both facings; no detached neck/arm or changed crouch silhouette was observed. The preview browser review passed against development and production with no browser errors; it also covers look slider keyboard input, vertical endpoints, responsive layouts, and reduced-motion look controls. Screenshots `26`–`29` include the four direction/facing combinations and compact comparisons.

## Stronger head movement at extreme aim

Increased the head/helmet limit from 24 to 60 degrees total in each direction, using a progressive curve: `pitch * (24 + 36 * verticalAmount²) / 90`, where `verticalAmount = abs(pitch) / (π / 2)`. Small aiming adjustments remain gentle and the head turns much farther near vertical. Torso lean remains capped at 6 degrees. The look presets now choose -90/+90-degree weapon aim so their head extremes are immediately visible.

TypeScript, production build, all 77 unit tests, and the full crouch/aim preview browser review passed. Updated the existing angle-limit check to also verify progression near level and steep aim. Reviewed the stronger up/down poses in standing and full crouch; refreshed the four facing/direction screenshots. Neck/helmet attachment and canvas framing remain intact.

## Approved stance integrated into gameplay

Practice now uses the approved upright and crouched character geometry, including the progressive 60-degree head turn and 6-degree torso lean. Hold S or Down arrow to crouch; either alias can remain held independently. The fixed-step simulation blends stance over approximately 0.18 seconds, preserves the feet while resizing the collider from 68 to approximately 54.2 world pixels, and checks clearance before expanding. A blocked release retries automatically after the character moves clear. Full crouch walks at 160 px/s; jump, thrust, fuel, and airborne speed retain their existing tuning. Jump takes priority over crouch, and held crouch applies again after landing once Space is released.

Gameplay uniformly scales the approved artwork by `68 / 85.94` to fit the original standing collider. Walking, backward walking, crouch shuffles, jumping, and thrust use fixed-length articulated legs and attached boot exhaust. Simulation and rendering share stance offsets for the grip; interpolated feet and stance drive visible aiming. Camera framing follows the feet so changing stance does not move the camera. The scaled muzzle offset also keeps tracers at the visible barrel, including downward shots from full crouch. The preview's small samples now use the gameplay artwork scale, and **Try in practice** enters the existing practice flow directly.

Validation: all 96 unit tests, TypeScript, and the production build passed. The four new browser scenarios cover alias press/release combinations, planted feet, blur/resume/restart, crouch walking and hits, lowered weapon alignment, a 56-pixel low-ceiling fixture with automatic standing after clearance, and crouch-to-jump-to-thrust-to-landing transitions. The 15 existing aiming, practice, and capture-fallback scenarios passed; the native capture scenario remains opt-in for the previously documented automation-browser limitation. After correcting the muzzle scale, all unit tests and the five affected crouch/firing browser scenarios passed again.

Reviewed gameplay crouch, low-ceiling, flight, standing/menu, and customization screenshots. Screenshots `30-gameplay-crouch.png`, `31-gameplay-crouch-ceiling.png`, and `32-gameplay-crouch-to-flight.png` record the new gameplay checks. The low ceiling is a test arena fixture; the shipped arena is unchanged. The compiled preview review passed, including desktop/mobile layout, both aim extremes and facings, reduced motion, and direct practice entry. The final production smoke passed at 1440 × 900 and 2× DPR with no browser errors, no external requests, and no development diagnostics. The existing user preview tab was advanced to the practice entry screen.

Detailed facial artwork and the broader movement, keyboard, and camera revisions remain a later pass.

## Detailed character preview — first milestone

Added `/?preview=character` and a menu link without changing the character used in practice, existing cosmetics, simulation, or asset-loading code. A lazy-loaded preview module owns all temporary selection, pose, and playback state. The App settings effect skips this screen entirely, including initial entry with current or legacy-only settings. The detailed catalog and renderer remain separate from the existing `Cosmetics` and gameplay drawing contract until visual approval.

The Base, Field, Scout, and Heavy recipes demonstrate an unobscured face, original three-quarter artwork, three contour-only body builds, open-brim headwear, facial hair, distinct gloves/hands and boots, and layered equipment. Both arms articulate to shared rifle-local trigger/support grips, including recoil. The approved legs, stance offsets, head/torso response, scale, muzzle convention and boot/exhaust anchors are retained. Named colour roles and Canvas paths need no additional image decoding or asset requests.

The preview provides an enlarged body, a level-aim face close-up, four gameplay-size figures, stance and aim controls, facing, crouch-depth and animation-phase scrubbers, forward/backward walking, jump/jet poses, temporary accessory removal, and joint guides. Playback is optional, disabled under reduced motion, and paused on hidden tabs. The final static frame stays painted after returning to the tab.

Validation: TypeScript, the production build, and all 103 unit tests passed. Seven new rig/catalog tests include 657 aim/crouch/recoil combinations, fixed segment lengths, exact hand/grip attachment, stance invariants, facing and recoil bounds. Five new browser scenarios passed alongside all 19 existing practice/aiming/crouching/capture-fallback scenarios; the previously documented native capture scenario remains opt-in. New browser checks assert byte-for-byte current/legacy settings preservation and zero storage writes, no gameplay runtime, distinct looks, twelve crouched extreme-aim combinations, standing and crouch walking, backward walking, jump/jet, frozen frame restoration, keyboard operation, reduced motion, 390/320px layouts, and menu/crouch/practice navigation.

Screenshot review found and fixed an 8px horizontal overflow at 320px by allowing the pose grid and controls to shrink. A code review caught a hidden-tab canvas reset; the focused visibility regression passed after preserving the final painted frame. Final art review aligned the rifle muzzle to the existing `(28, 0)` local anchor and kept neutral headgear crowns inside the standing-height envelope. Reviewed the refreshed screenshots `33` through `40` at enlarged and gameplay scales, including both facings, extreme aim, jet attachment, and narrow layouts.

`BURNHOP_PREVIEW_URL=http://127.0.0.1:4173 node scripts/review-character.mjs` passed against the final compiled build with zero browser errors and preserved settings/runtime isolation. Screenshots `41-character-production.png`, `41-character-production-stage.png`, and `41-character-production-crouch.png` record that review. The normal production gameplay smoke also passed with no errors, no external requests, and no development diagnostics. The existing user browser tab was opened to the detailed character preview for review.

The complete cosmetic catalog, creator controls, saved-look persistence/migration, and gameplay artwork replacement await the agreed visual approval. They are not claimed as implemented or tested in this milestone.

## Preview review fixes — waist layering and hit feedback

Both the detailed preview and current gameplay renderer now clip rounded thigh caps below the pelvis waist and draw the belt/pouches over the near leg. Joint positions, stance calculation, planted soles, colliders, and firing origins are unchanged. Hit feedback now tints the complete rendered character through a cached transparent Canvas surface, including SVG headgear, both legs, arms, boots, equipment, and rifle. It does not tint surrounding scenery or create/decode assets every frame. The existing eight-tick flash duration and 20 damage per practice hit remain unchanged.

The character preview has a keyboard-accessible **Show hit flash** checkbox that freezes feedback on the enlarged, portrait, and gameplay-size views, including under reduced motion. All appearance and inspection state remains temporary; the detailed artwork is still isolated from practice pending the user's next visual review.

Validation: all 103 unit tests, TypeScript, and the production build passed. Twenty existing preview, aiming, practice, and crouching browser scenarios passed, including clearance under cover and stance/firing alignment. One runtime test needed an isolated-output rerun after concurrent Playwright processes collided while writing trace artifacts; the rerun passed. Four new rendering regressions passed: 24 waist pixel samples across stance/facing/builds, 40 complete-character flash comparisons with loaded SVG assets and unchanged alpha/background, keyboard/reduced-motion inspection at both scales and 320px width, and an actual practice shot reducing health from 100 to 80 before the flash clears. Only a tiny antialiasing rounding allowance is used for flash colour comparisons; unflashed opaque components and background leakage are rejected.

Reviewed refreshed standing, crouching, extreme-aim and travel screenshots plus `42-*` normal/hit comparisons. The practice hit and cleared-flash captures confirm consistent feedback on the actual target. Both compiled-preview and compiled-practice smoke checks passed with no browser errors; the practice smoke reported zero external requests. The full creator and detailed gameplay integration remain deferred until review.

## Full character creator and gameplay integration — approved and complete

The user approved the preview and subsequent waist/hit-feedback corrections. The completed detailed renderer now draws the menu pilot, creator, character study, crouch study, player, and an explicitly styled training bot. The retired numerical cosmetics/rendering path and visor-specific colour decoding have been removed. The shared skeleton and simulation are unchanged: all builds retain the 36-pixel collider width, 68-pixel standing height, approximately 54.2-pixel crouch height, weapon origin, sole positions, and exhaust anchors.

The catalog provides 64 styles across 18 parts, six skin tones, six independent hair/facial-hair colours, eight independent clothing/equipment palettes, and Field/Scout/Heavy outfits. The approved short beard is retained alongside the planned beard options. New hair, moustache, goatee, facial shapes/noses, and tactical shirt have distinct vector artwork. Outfits preserve identity/build; named looks capture everything. The creator includes focused thumbnails, enlarged/native previews, pose/aim/facing controls, optional motion, responsive navigation, keyboard-accessible selection, automatic saving, and full named-look operations with deletion Undo.

Version 2 settings migrate both previous Burnhop settings and the legacy fallback, preserve sound/reduced-motion preferences and all nine original colour-role values, and default unknown identifiers individually. Saved snapshots remain independent of ordinary edits. Corrupt primary data can recover from the legacy fallback. When storage reads/writes fail, in-memory editing and practice continue with a clear creator notice. Character-study choices remain temporary and do not write settings. Both creator and study are part of the initial UI bundle; opening them does not depend on a new lazy UI chunk fetch.

Validation: **123 unit tests**, TypeScript, and the final production build passed. Twenty new model tests cover catalog validity, exact colour migration, malformed/unknown data, storage failures, and every snapshot operation. **37 browser scenarios passed**: six creator scenarios plus 31 gameplay/preview/integration scenarios. The existing native fullscreen/pointer-lock automation case remains opt-in and was skipped. Browser checks exercised every catalog item, independent colours, outfit identity preservation, all saved-look operations and reload, 390/320px layouts, reduced motion and keyboard operation, invalid/unavailable storage, three builds carried into practice, crouch clearance, aiming, nearby cover, movement, firing, target flash/damage, loading failure/Retry, and capture fallbacks. Observed idle practice rendering was 60 FPS in local Chromium; this is not a cross-hardware benchmark.

The reusable `scripts/review-catalog.mjs` gallery checked distinct pixels for all 64 choices, 18 accessory combinations, and 18 build/pose cases with zero browser errors. Reviewed all catalog galleries, creator desktop/saved/outfit screens, narrow layouts, all-build menu/crouch/practice captures, and hit feedback. The final production creator, character-study, and gameplay smoke checks passed with zero browser errors; creator/gameplay checks reported zero external requests and absent development diagnostics. New `scripts/review-creator.mjs` covers production snapshot/restore/reload, mobile layout and practice entry. Screenshots `43`–`47` record the completed feature. The user's existing browser tab is open to the updated main menu.

Movement tuning, new bindings, camera revisions, additional weapons, multiplayer, and online cosmetic storage remain outside this change.

## Tighter camera and configurable controls — September 5, 2026

Implemented centered camera following with exponential rates 20/s horizontally and 24/s vertically, capped to 24/32 logical pixels of lag, and the existing arena bounds and floor padding. The feet-based anchor prevents crouch camera bob. Following the view-label clarification, 1x is close (scale 1.5), 3x is medium (1.1), and 5x is wide (0.75). New practice starts at 1x and Tab cycles 1x → 3x → 5x → 1x; pause and restart preserve the current session zoom. Scale and camera update atomically before aim projection.

Settings are available from the menu and pause screen. Every gameplay action supports primary/secondary keyboard or mouse-button bindings, with fixed Escape pause, reviewed conflict swaps and resets. Movement, crouch, fire, alternate aim and jetpack support Hold/Toggle. The default aim can be the line or crosshair. Combined Space preserves jump-first and early-hop behavior; separate jetpack input permits direct takeoff. Landing and fuel exhaustion require fresh jet activation. Version 3 migration preserves prior pilots, saved looks, sound and motion preferences, and storage failures retain in-memory editing. Pause settings keep the same runtime mounted and require a deliberate Resume click.

Validation: **178 unit tests**, TypeScript and the final production build passed. The full browser regression run passed **46 scenarios**, with the opt-in native pointer-lock case skipped. Review then added three passing regressions: fixed Escape from HUD focus after remapping Tab, native mouse-back Pause preserving browser history through release, and left-mouse Pause preventing release from clicking the newly displayed Resume button. After the gesture fix, the **11 affected aiming/settings scenarios** passed again. There are now **49 verified browser scenarios** plus the single opt-in native case. Side-button gameplay history behavior was exercised through Chromium's native input protocol; settings capture also checks cancellable side-button events.

Native Arc verification on a separate local preview origin confirmed fullscreen/pointer-capture entry, Tab zoom, Escape release, paused settings, changing the default to crosshair, and recapture on explicit Resume. The native automated relative-pointer/button-chord case remains opt-in; this pass does not claim new manual validation of held mouse chords. The temporary native test tab and its additional preview server were closed afterward.

Reviewed desktop settings, narrow bindings/aiming (390px), embedded pause settings, and all three camera presets at 2x DPR. Screenshots `48-controls-settings-desktop.png`, `49-controls-aiming-narrow.png`, and `50-camera-1x.png` through `52-camera-5x.png` are saved under `docs/screenshots/`. No gameplay tuning, appearance dimensions, network service, or new dependencies were introduced.

The view-order follow-up measures the pilot's projected height, in addition to checking the HUD label, to prevent an inverted physical view from passing. Camera checks cover the close new-session default, the complete cycle, preserved pause/restart selection, arena bounds, and both aim styles at 2x DPR. Screenshots `50-camera-1x.png` through `52-camera-5x.png` were refreshed and visually reviewed with the corrected framing. Shooting fixtures select the medium view when they need the distant spawn target visible.

Follow-up validation: **180 unit tests**, TypeScript, the production build, and **49 unique browser scenarios** passed across the focused runs and corrected-fixture reruns. The native fullscreen/pointer-lock case remained skipped in headless Chromium. The rebuilt production smoke passed with no browser errors or external requests. Initial browser failures came from shooting at the now-offscreen target and one development reload during edits; all affected scenarios passed after selecting 3x and rerunning against stable source.

## Coverage limits

Automated browser coverage is Chromium on this macOS development machine, including 1280 × 720, 1024 × 768, and 1440 × 900 at 2× DPR. Firefox, Safari, touch controls, other hardware, and multiplayer capacity have not been verified. Sounds are implemented through Web Audio; no subjective listening evaluation is claimed.

Local practice, one non-attacking bot, and one rifle are implemented. Online rooms, player damage/death, accounts, and additional content remain future milestones.
