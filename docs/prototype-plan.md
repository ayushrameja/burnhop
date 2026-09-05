# Jetpack Practice Prototype — Revised Technical Plan

Agreed September 5, 2026. Working title: **Burnhop / Outpost 07**.

## Agreed stack

Standalone desktop browser game in `jetpack-prototype` using TypeScript, Node.js 24 LTS, pnpm, Vite, React and CSS for interface, native Canvas 2D for rendering, a custom TypeScript simulation, browser Web Audio, Vitest, and Playwright. Use ordinary React state/reducers for UI; no game engine, Next.js, Redux, backend, or networking in this milestone.

Future direction: private online rooms with 2–16 players. The development runtime does not commit the future match server to a runtime or networking library. Reconsider Next.js for a substantial public website and a shared UI store if application-state complexity warrants it.

## First playable experience

Game flow: real loading → main menu → optional customization → Practice.

- Loading tracks module initialization, artwork decoding, arena loading, and colour-variant preparation. No artificial wait; required failures offer Retry.
- Practice is available; Multiplayer is unavailable. Include customization, sound control, and a control reference.
- Original cartoon outdoor training outpost with one permanent dark palette: charcoal-green interface, sage and amber accents, moonlit terrain, and bright readable platform edges, jet flames, and shots. Preserve the established layout; no light theme or theme switch.
- Soldier has separate head, torso, arms, hands, legs, boots, weapon, and jetpack, animated through shared pivots.
- Three colours each for headgear, shirt, and trousers with live preview and guarded local persistence.

| Control | Behaviour |
| --- | --- |
| A / D | Move horizontally |
| Space on ground | Jump |
| Release, then hold Space airborne | Jetpack thrust |
| Release Space | Cut thrust |
| Mouse | Aim |
| Hold left mouse | Fire |
| R | Reload |
| Escape | Pause |

The second Space press has no double-tap timing window. Holding the original jump never activates thrust or automatically repeats jumps. A descending press within a predicted 150 ms landing window queues a hop on contact instead of thrust; releasing Space preserves that hop. If steering misses the predicted landing, a held press activates thrust when the buffer expires. Landing or empty fuel stops thrust. Allow approximately 130 ms of jump forgiveness after leaving a platform.

Fuel regenerates after 400 ms without thrust, including midair. A full tank lasts 3.5 seconds of continuous thrust and takes approximately 3.3 seconds to refill after the delay. Engine acceleration starts at 3600 px/s² for the first 10% of fuel spent, then tapers linearly to 1800 px/s² at empty. The curve depends on remaining fuel, not time since the latest press. Horizontal cap 320 px/s, approximately 90 px jump, strong ground braking, and airborne momentum. Buffered hops preserve horizontal velocity and consume no fuel. Keep tuning values together for playtesting.

One approximately 2400 × 1350 arena with a safe floor, four solid elevated platforms, and a smooth follow camera. Platforms block movement and shots. One stationary bot: 100 health, visible hit reactions, two-second respawn. Player remains at 100 health.

First rifle: hitscan with visible tracers, 30-round magazine, unlimited reserve ammunition, 10 shots/second, 20 damage/hit, and 1.2-second manual reload. Shooting while flying supported; cover blocks shots.

## Architecture and future multiplayer

- Simulation owns position, velocity, collision, fuel, weapon timing, hits, health, and respawn timers.
- Presentation owns camera smoothing, poses, particles, recoil animation, and audio.
- Application UI owns loading, screens, customization, preferences, and eventually lobby/account state.

Simulation uses a fixed 60 Hz and plain TypeScript, independent of React, Canvas, browser clocks, and Node-specific APIs.

- `InputCommand`: tick, actor ID, movement, jump press/hold, aim direction, fire, reload.
- `WorldState`: serializable entities with stable IDs and gameplay timers.
- `stepSimulation`: advances one tick, producing gameplay events.
- Renderer consumes previous/current snapshots and interpolation fraction.
- HUD subscription exposes relevant values without copying all simulation state into React.

Use swept collision checks against platforms. Artwork/customization never change collision geometry. Pointer aiming uses the rendering camera and scale transforms. React controls one disposable game runtime per practice session. Rerenders cannot duplicate loops/listeners. Pause and clear inputs on focus loss/hidden tabs; intentional resume. Cap catch-up work after interruptions.

Future multiplayer reuses simulation on an authoritative room server; clients send commands and consume updates. Prediction, reconciliation, transport, hosting, and capacity validation belong to the multiplayer milestone.

## Implementation sequence

1. Save plan; scaffold project; pin tested tools; configure typechecking/tests.
2. Simulation, input, collision, movement, jetpack, and camera.
3. Rifle, target damage/death/respawn, feedback.
4. Modular character, customization, real loading, React menus/HUD/pause.
5. Audio, browser playtests, screenshot review, fixes.

Compact HUD: health/ammunition/fuel at edge and overhead target health. Extended controls in Pause. Resume, Restart Practice, Main Menu. Debug-only bounds/velocity/fuel/frame timing. Prioritize responsiveness over visual/audio polish.

## Verification and completion

- Test movement, collisions, jump/jet transitions, depletion/regeneration, cadence, cover, reload, damage, respawn.
- Identical commands under 30/60/144 Hz rendering schedules yield identical simulation state.
- First held jump never ignites thrust, landing held never jumps again, empty fuel never pulses thrust automatically.
- Full browser flow including persistence, firing while flying, facing changes, pause/restart/menu.
- Aim after resize and input recovery after focus loss.
- Inspect screenshots of loading/menu/customization/movement/flight/hits/pause; fix alignment, camera jitter, unclear platforms, HUD overlap.
- Run typechecking, tests, production build. Target smooth 60 fps on development machine; report observed performance/browser coverage.
- Deliver launch instructions, controls, screenshots, and limitations.

Milestone boundaries: desktop browser; local practice; one weapon; one non-attacking bot. Mobile, more content, player damage/death, accounts, and online rooms are future work.
