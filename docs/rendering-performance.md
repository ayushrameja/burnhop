# Rendering performance

The game keeps React for menus and HUDs and Canvas 2D for gameplay. Graphics settings apply to both practice and multiplayer and persist in the existing settings save. Older saves receive Balanced graphics while preserving controls, audio and cosmetics.

| Preset | Render resolution | Frame ceiling | Terrain detail | Effects |
| --- | --- | --- | --- | --- |
| Low | 50% | 60 FPS | Low | Low |
| Balanced (default) | 75% | 60 FPS | Medium | Medium |
| High | 100% | Display rate | High | High |

Each field can be customized, including a 120 FPS ceiling. Resolution scales each canvas dimension after the existing device-pixel-ratio cap of 2; 75% draws about 56% as many pixels as 100%. React menus and the HUD retain their resolution. A frame ceiling is a maximum, not a guaranteed rate. Browser refresh cadence can make a 60 FPS cap uneven on a 144 Hz display; compare 120 FPS or display rate when that hardware has enough headroom.

## Changes

- Outpost terrain textures are painted by a module worker using OffscreenCanvas and transferred as ImageBitmaps. The visible collision contour is immediately available while detail arrives. Worker startup/rendering failure keeps the simplified terrain playable.
- Terrain requests prioritize the visible area, then nearby surfaces. Existing usable textures remain visible during upgrades. Zooming out reuses higher resolution textures; reducing terrain quality can replace them with smaller ones. Offscreen textures are evicted to keep retained terrain bitmaps within 128 MiB. This excludes the one in-flight worker surface, canvas buffers and browser/driver copies; it is not a total process-memory limit.
- Static decoration uses cached vector paths. Rigid character heads use a separate 8 MiB cache; limbs, aim, reload, hit feedback and animation remain live. Distant multiplayer characters skip drawing and pose solving while retaining animation clocks.
- Particle counts are bounded by quality. Decorative exhaust emission follows elapsed time instead of monitor refresh count. Low effects keep firing and hit feedback while reducing decorative particles and shading.
- Simulation, prediction, input sending and audio continue on animation callbacks even when the renderer skips a frame to meet the selected ceiling. Gameplay simulation stays at 60 Hz; server snapshot rate remains unchanged.
- Multiplayer actor views and event buckets are reused; effect arrays compact in place. Pointer projections reuse canvas bounds captured during resize. HUD updates reuse React state when displayed values have not changed, including checks for fuel-warning and reload boundaries. Fuel-gauge paths are computed once.
- Input identifiers reserve 256 IDs in session storage before use, replacing a synchronous write for every input. An abrupt refresh skips unused IDs in the reserved range. Existing appearance decoding and asset caches remain in use.

## Local measurements

Raw evidence: [rendering-benchmark.json](./rendering-benchmark.json). These are isolated renderer runs on this Mac using headless Chromium, eight actors and a fixed zoom route. They are **not Windows FPS predictions**. CPU submission timings exclude asynchronous raster/GPU completion. No other tests ran during these measurements.

| Measurement | Original | Optimized High | Balanced | Low |
| --- | ---: | ---: | ---: | ---: |
| First draw, DPR 1 (ms) | 136.8 | 8.9 | 8.6 | 8.9 |
| Warm submission p95, DPR 1 (ms) | 0.9 | 0.6 | 0.6 | 0.6 |
| Zoom out / return, DPR 1 (ms) | 58.2 / 110.9 | 0.6 / 0.5 | 0.5 / 0.5 | 0.5 / 0.5 |
| First draw, DPR 2 (ms) | 232.5 | 9.8 | 9.7 | 9.2 |
| Warm submission p95, DPR 2 (ms) | 29.0 | 31.7 | 0.7 | 0.6 |
| Median frame interval, DPR 2 (ms) | 50.0 | 50.0 | 33.3 | 16.7 |
| Largest sampled frame interval, DPR 2 (ms) | 233.3 | 66.7 | 33.4 | 16.8 |

The main improvement at equal quality is avoiding synchronous terrain preparation during entry and zoom changes. First draw now shows usable geometry while the worker prepares detail. High quality does not improve sustained DPR-2 throughput in this setup, and its warm p95 is slightly worse. Lower resolution gives the clearest sustained improvement. Balanced's low submission time alongside 33.3 ms frame intervals also shows why JavaScript timings alone cannot establish the bottleneck.

To reproduce, run `pnpm dev --port 5173 --strictPort` in one terminal, then `BURNHOP_BENCH_VARIANT=balanced node scripts/benchmark-renderer.mjs load-results/renderer-balanced.json` in another. Supported presets are `high`, `balanced`, and `low`; use Node 22.18+. The harness calls the renderer every animation frame to compare rendering cost independently of runtime frame limiting. Compare the same browser, machine and workload with other heavy work stopped. The original run used commit `996b89b`.

## Playtest evidence

Use **Settings → Graphics → Copy performance report** after a slow section. Clipboard-denied browsers show selectable report text. Reports include the build, browser, screen/canvas dimensions, selected graphics, frame percentiles, render submission percentiles and cache usage. Multiplayer reports also include network-arrival and correction metrics. They contain no room code, authentication token, player name or position and are never uploaded automatically.

Frame percentiles cover the latest 1,800 drawn frames (about 30 seconds at 60 FPS); counters are cumulative across the session. FPS uses frames divided by elapsed time. Paused time is excluded from frame samples. Reports survive leaving the session until the page is reloaded, and opening Settings does not erase the preceding stutter. CPU/GPU model, browser hardware acceleration, refresh rate and power mode must be recorded separately.

For the Windows comparison, repeat the same Outpost route and player count at Balanced and Low, then collect one report per run. Include movement, zoom, sustained jetpack use and firing. Compare frame p95/p99 and long hitches alongside network metrics. The affected Windows computer still needs this validation.

## Verification

- 345 unit/backend tests passed. Coverage includes render cadence versus simulation cadence, storage reservation/recovery, texture lifetime/budget, culling and refresh-independent particles.
- Browser gameplay, graphics persistence/migration, aiming at DPR 2, warnings, pause/resume, worker failure and desktop/narrow layouts passed. Cached decoration matches original pixels at three transforms; cached character heads preserve artwork across all four looks, both stances and three aim angles.
- Both multiplayer tests passed, covering match admission, refresh, host transfer, graphics changes during a match, latency/jitter, replay stalls and reconnects.
- Client/server production builds passed. Local production-preview smoke verified the emitted worker asset, movement, jetpack, quality changes, pause/resume and performance report with no page errors.
- Native fullscreen/pointer-lock smoke remained opt-in and was skipped during these performance checks; headless flows use the repository's capture fixture. No Windows hardware was available. These are pre-deployment results; production rollout evidence is recorded separately under `load-results/`.
