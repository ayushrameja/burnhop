# Combat update screenshots

The entrance images were refreshed from the actual app on 6 September 2026 after the final approved copy was applied:

- **JETPACKS ON. GOOD SENSE OFF.**
- **BURNHOP**
- **Small pilots. Poor impulse control.**

`entry-desktop.png` shows the desktop entrance. `entry-mobile.png` shows a 390 × 780 viewport with reduced motion enabled. Both include the initially silent sound control and the visible Enter game button. The mobile pilot holds a static pose; neither layout clips the copy or controls.

Final focused Chromium verification passed all five scenarios in `tests/entry-flow.spec.ts` and `tests/combat-feedback.spec.ts`. The feedback scenarios mount the real component and audio class in a test-only fixture: a lethal hit retains its red cue, a simultaneous credited kill follows in blue, both fade at zero health, and the heartbeat stops. At 1440 × 900 and 390 × 780, reduced-motion low-health feedback remains static and the overlay does not intercept input or obstruct the central playfield. These component checks do not simulate a complete online trade kill.

The corresponding temporary feedback captures are in `test-results-feedback-final/`. The fixture is outside the production app entrypoint and adds no production debug controls.
