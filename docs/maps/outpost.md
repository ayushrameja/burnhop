# Outpost

Outpost is a playable adaptation of the classic Mini Militia map. It preserves the recognizable layout: the concrete bunker in the west, the lower tunnel and shelf chain, the central rising island, the diagonal eastern sky ramp, and the wooden bunker above the broad eastern base.

The terrain contours are hand-authored and simplified. This is not an exact asset or engine port. The map uses a 3328 × 1152 design grid, scaled uniformly by **1.4** with **180 world pixels of extra sky** above it. The playable world is 4659.2 × 2100; the extra space underneath the islands supports falling recovery. This scale accommodates Burnhop's 68-pixel standing collision body. The narrow bend in the western tunnel requires crouching; small steep rock outcrops require a hop or jetpack burst.

All shipped artwork is drawn locally. The repository contains no downloaded Mini Militia textures, extracted sprite sheets, imported TMX data, or third-party map-editor code.

## Files

- `scripts/build-outpost.mjs` is the authored terrain source and preview generator. Run `node scripts/build-outpost.mjs` from `jetpack-prototype` after changing contours or spawn points.
- `public/assets/outpost.json` contains terrain, map bounds, and eight named standing spawn points. Actor coordinates refer to the top-left corner of the collision body.
- `public/assets/outpost-preview.svg` provides the map-selection preview.
- `src/game/outpost.test.ts` exercises actual map data, safe spawn support, crouched tunnel traversal, jetpack ascent from the lower saddle to the central rise, and practice fall recovery.
- `src/game/outpostRenderer.ts` draws the original scenery and caches static terrain artwork. `node scripts/review-outpost-art.mjs` captures an overview and close-ups from this same renderer while Vite is running.

The dark rock pillars and bunker back walls are decorative background surfaces. They do not close off the passages between the solid terrain contours. Rendering and collision share the same solid outlines.

### Texture detail and bunker clearance

The scenery includes mineral grain, layered stone facets, cracks and chipped edge stones; concrete has pores, casting seams, stains and wear; timber has board joints, flowing grain, knots and fasteners. Static detail is rasterized only when an island comes into view. The cache uses up to three physical pixels per world pixel according to zoom and display density, keeps logical drawing bounds unchanged, evicts old offscreen textures within a 128 MiB terrain budget, and releases its backing canvases when the session ends.

The west bunker's right roof lip and both east bunker lips previously narrowed to roughly 36–45 world pixels, below the 54.2-pixel crouched collider. Six roof-underside vertices were lifted: 18.2 pixels at the west right lip and 26.6 pixels at each east lip. The tightest clearance is now about 63 pixels. Floors, roof tops, pilot size, movement tuning and collision rules remain the same. All four bunker mouths support crouched travel in both directions; the three low lips still prevent standing up until the pilot clears them.

## Current gameplay scope

The map runs in local practice with the existing player and training target. Falling beneath the world returns the player to the western courtyard while preserving practice results and inventory. This recovery is a practice convenience; it does not reproduce Mini Militia's boundary damage rules.

The eight named spawn points provide reusable map data for future networked play. They are not a multiplayer room system, team assignment policy, safe respawn selection algorithm, or a claim that networked matches are complete. Those systems must select and validate spawns when implemented.

## References

- [Courage Militia: OUTPOST — Detailed Maps, Episode 1](https://www.youtube.com/watch?v=J2H0hwqytWM), August 2016: visual overview and landmark reference.
- [MM Gaming: All You Need to Know About Outpost](https://www.youtube.com/watch?v=Bu_r663Guqc), January 2017: detailed map overview, credited to Courage Militia.
- [x64BitWorm's public Mini Militia map editor](https://github.com/x64BitWorm/mini_militia_map_editor/tree/main/outpost): structural research for the design-grid dimensions, terrain arrangement, and original spawn landmarks. Its map data, code, and textures are not shipped with this adaptation.

The adaptation matches the classic reference's main routes and silhouette. Small contour details, art treatment, actor scale, spawn placement, weapon pickups, and practice recovery differ from the original game.

## Verification — 5 September 2026

- `pnpm test`: all **266 unit tests passed**, including 13 polygon collision cases, four actual map traversal/spawn cases, ten bunker clearance cases, five texture-cache cases, and ten arena loading cases.
- `pnpm build`: TypeScript and production compilation passed.
- `pnpm exec playwright test tests/outpost.spec.ts`: all **four scenarios passed**, covering real map loading, movement, thrust, combat/reload, restart, switching, retry and canceled requests.
- Regression run of `practice.spec.ts`, `entry-flow.spec.ts`, `camera-controls.spec.ts`, `capture.spec.ts` and `audio.spec.ts`: **27 passed**, **one opt-in native capture test skipped**. The completed music/audio changes remain integrated.
- Visual checks used the actual Canvas scenery at overview and gameplay scale, plus menu checks at 1440×900, 1024×768 and 390×844. Radio selection works with arrow keys, focus stays visible, and there is no horizontal overflow.
- Browser automation uses the existing fullscreen/pointer-lock fixture; this does not establish native browser capture compatibility or multiplayer player-count/performance capacity.
- Texture/clearance update: `tests/outpost-bunkers.spec.ts` passed all four high-DPI browser scenarios, with eight direction traversals, per-frame overlap checks and release-to-stand coverage beneath the low lips. The initial geometry reproduced nine failures in the ten focused unit cases before the fix.
- After the texture/clearance update, all eight additional scenarios in `tests/outpost.spec.ts` and `tests/crouching.spec.ts` passed, covering arena switching/loading/retry and existing crouch, aim, jump, thrust, blur and restart behavior. The update's browser total is **12 passed**.

Screenshots: [overview](../screenshots/outpost/overview.png), [gameplay](../screenshots/outpost/gameplay.png), [menu](../screenshots/outpost/menu.png), [narrow menu](../screenshots/outpost/menu-390.png).

Updated bunker screenshots: [west right entrance](../screenshots/outpost/west-right-entrance-crouch.png), [east left entrance](../screenshots/outpost/east-left-entrance-crouch.png). Run `node scripts/review-outpost-performance.mjs` with Vite running to record a short rendering smoke check at all zooms and both 1×/2× display densities.

The rendering smoke observed approximately 60 FPS at 1× display density across all view presets. At 2× display density, this headless Chromium environment measured 18–19 FPS for Outpost and about 24 FPS for the unchanged practice range. These are recorded observations, not a native GPU frame-rate guarantee; the 2× case is substantially slower for both maps. Raw results are in `docs/screenshots/outpost/texture-performance.json` and `range-comparison-performance.json`.
