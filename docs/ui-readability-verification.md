# HUD, arena selection and landing audio

Verified on 2026-09-05.

The HUD separates a cyan segmented jet-fuel gauge and red health strip on the left from ammunition and reload progress on the right. Low fuel, empty fuel, low ammunition and reload states have text cues as well as color. Health uses the existing player state; safe practice remains at 100. Wide displays enlarge both clusters, while narrow screens retain clear aiming space.

The menu places both arena previews directly above Enter practice. Native radio controls support mouse, touch and keyboard selection, with a selected checkmark and matching launch destination. The footer no longer spans an invisible hit area over other controls on shorter screens.

Landing uses a 170 ms composite of existing recorded concrete footsteps and a quiet gear tick. Fall speed controls volume at natural pitch. Each landing plays one voice. The fallback uses damped noise instead of a pitched body. Source credits and the reproducible mixing recipe are in [the sound README](../public/assets/audio/sfx/README.md).

Validation:

- `pnpm test`: 269 tests across 19 files passed.
- `pnpm build`: TypeScript and production build passed.
- 24 distinct Chromium browser scenarios passed: six new UI scenarios; 17 audio, fullscreen-entry and Outpost regressions; and the existing menu/customization/practice scenario. The new landing and radio-sound assertions also passed on recheck.
- Layouts inspected at 390×844, 1440×900 and 2560×1440, plus the existing 1280×720 browser checks. Live keyboard/mouse input verified fuel burn, depletion and recharge, firing, low/empty ammo, reload progress and keyboard map selection.
- Browser tests use the repository's fullscreen/pointer-lock fixtures while running the real input, simulation, rendering and Web Audio code. Sound checks verify decoded playback, lifecycle and waveform properties; perceived timbre remains subjective.

Screenshots: [desktop menu](screenshots/ui-readability/menu-1440x900.png), [wide HUD](screenshots/ui-readability/hud-2560x1440.png), [mobile menu](screenshots/ui-readability/menu-390x844.png), [low fuel](screenshots/ui-readability/fuel-low.png), [reload](screenshots/ui-readability/ammo-reloading.png).
