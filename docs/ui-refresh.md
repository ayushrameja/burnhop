# Game menu and fullscreen refresh — 2026-09-05

## Final entry flow

The first screen is a quiet cold desert at night: a moon, stars, layered dunes, drifting wind, and a single Enter game button. It contains no menu, character, logo or other navigation. That gesture requests fullscreen only and reveals the existing animated pilot main menu with the cursor free.

The main menu keeps its charcoal, warm white and red design. Practice range requests mouse capture, reports real asset loading progress, and starts the range. Multiplayer — coming soon is restored as a disabled option above Customize pilot and Settings & controls.

Fullscreen is required across every surface, including the menu, settings and character studies. When fullscreen ends, gameplay pauses immediately and an undismissable Return to fullscreen screen covers the app. Underlying controls are hidden and inert; settings keybinding listeners suspend. Returning to fullscreen restores the previous screen and keeps a practice session paused until Resume. There is no windowed-play path. Unsupported/denied fullscreen leaves the entrance visible with an explanation and retry.

Tap Escape to pause; hold it continuously for about two seconds to exit fullscreen where Keyboard Lock is supported. The hold persists across the gameplay-to-pause transition. A compact progress bar appears after 150ms, with release-to-cancel guidance; repeated taps do not exit. Release, blur, hidden-tab state, other keyboard/pointer activity, or fullscreen loss cancels the hold. The pause screen retains an explicit Exit fullscreen button. A browser may reserve Escape and exit immediately; either path displays the required gate when fullscreen ends. Returning to the main menu destroys the practice runtime while retaining the fullscreen shell. Pending loading/capture attempts are invalidated on cancellation so late completion cannot start gameplay; cancelling practice capture preserves the existing fullscreen menu.

## Visuals

Both the atmospheric entrance and animated pilot menu use original native Canvas artwork with cached static scenery. Reduced motion freezes the ambient wind/stars and pilot loop. Hidden documents stop their animation loops. The compact ammo/fuel HUD, quiet pause screen, and matching creator/settings style from the first pass are retained.

Reviewed screenshots are in `screenshots/entry-gate/`: desktop/mobile entrance, wind frame and main menu with Multiplayer. Older first-pass screenshots remain in `screenshots/ui-refresh/` for history.

## Verification

- TypeScript and production build pass.
- 196 unit tests pass, including 24 capture lifecycle tests.
- Production smoke passes at 1440×900 @2x, covering entry, gameplay inputs, pause/focus, required fullscreen recovery, explicit resume and absence of production debug APIs. Headless capture APIs are emulated; no external requests or browser errors were observed.
- Native Arc verified separately through desktop UI before the hold change: fullscreen-only menu entry, native mouse capture and running practice, first-Escape pause, persistent return gate, restored paused session and successful explicit resume. Reported native rendering was 144 FPS in that session.
- Desktop and 390px entrance screenshots reviewed; native fullscreen-only entry also succeeded in standalone automated Chromium. Wind changed foreground pixels across two frames; reduced-motion canvas remained unchanged.
- Final browser regression suite: 56 passed, 1 opt-in native capture test skipped, 0 failures. Coverage includes fullscreen-only entrance, persistent gating, menu/settings restoration, cancellation during loading, pointer denial without windowed fallback, paused world/zoom preservation and keybinding capture isolation. Native automated pointer capture remains opt-in due the headless browser limitation on this host.
- After the Escape hold change, focused browser verification: 21 passed, 1 native opt-in test skipped. Includes delayed feedback, hold timing across pause, early-release reset, repeated taps/OS repeat, all cancellation paths, settings behavior and fullscreen restoration.

Keyboard Lock reference: https://developer.chrome.com/blog/better-full-screen-mode.
