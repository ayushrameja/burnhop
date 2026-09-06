# Browser shortcuts and leaving a session

During gameplay, Burnhop requests capture of `Escape` and `KeyW`. Capturing `KeyW` also covers Ctrl+W, Ctrl+Shift+W and Cmd+W where the browser/OS permits it. Delivered close shortcuts are cancelled even if W is unbound; if W is assigned to an action, that action still receives the press while Ctrl is held. Existing bindings are preserved. Either Ctrl key can be assigned to crouch in Settings → Bindings.

Pausing returns keyboard capture to Escape alone, so browser shortcuts work normally in menus. Active and paused practice, and multiplayer while a match is playing (including its pause menu and reconnect period), have a browser-owned close/reload confirmation. Cancelling the dialog preserves the local practice session or multiplayer seat and clears held input. A multiplayer match continues on the server. Deliberate reload confirmation works with the existing reconnect flow. Leaving practice/multiplayer through the game menu removes the guard; lobby and results views do not prompt.

## Escape lifecycle

Keyboard capture is requested directly in the entry gesture, before fullscreen consumes activation. Entering/resuming retries capture; failure is reported instead of being silently ignored for the entire fullscreen visit. A retry button is available after rejection. Requests are serialized and stale grants are released after cancellation, fullscreen exit or disposal. A pending gameplay grant is downgraded if the player pauses before it resolves. Failed changes to menu capture explicitly unlock the previous key set.

With working capture, tapping Escape pauses inside fullscreen. Holding it for two seconds or selecting Exit fullscreen still exits deliberately. Without working capture, the browser can consume Escape before JavaScript sees it. The game cannot override that decision: it pauses safely, retains the session and offers Return to fullscreen, followed by explicit Resume/Enter match. The notice points to the on-screen pause button as the fallback. There is no automatic fullscreen re-entry loop.

## Browser evidence and limits

- The [Keyboard Lock specification](https://wicg.github.io/keyboard-lock/) documents modified-key capture, calls before fullscreen, best-effort OS support and the two-second Escape exit. A fulfilled request is not proof that every OS shortcut is intercepted.
- [Chrome's fullscreen guide](https://developer.chrome.com/blog/better-full-screen-mode) describes using keyboard capture to keep a short Escape press inside fullscreen.
- [Brave issue 34231](https://github.com/brave/brave-browser/issues/34231) reports that fingerprinting protection changes Escape handling on Windows/Linux. This is a plausible explanation for the reported playtest behavior, not a confirmed diagnosis of the players' current browsers. The game does not change browser privacy settings.
- [MDN's beforeunload documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event) explains that the close confirmation needs prior user interaction and uses generic browser wording. It cannot display our own exact “Do you want to quit?” text and is not guaranteed for mobile termination, crashes or forced process shutdown.
- Browser permission behavior varies. Chrome's [permission article](https://developer.chrome.com/blog/keyboard-lock-pointer-lock-permission) now carries a March 2026 notice withdrawing its planned permission rollout; older articles still describe it as mandatory. The UI therefore says **if** the browser asks, rather than assuming a universal permission prompt or setting.

## Validation

Capture/leave-guard unit tests cover success, rejection, synchronous failure, missing APIs, retry, pause/resume key sets, stale grants, teardown and session lifetime. Browser checks cover Ctrl crouch with W movement, unbound close shortcuts, real native beforeunload dialogs (cancel close / accept reload), denied and unavailable keyboard capture, preserved practice state, narrow fallback layout, Escape taps and two-second holds. Fullscreen and pointer/keyboard behavior use the repository's capture fixture in these checks.

Both multiplayer flows passed on an isolated local frontend at port 5194: network delay/jitter, replay stalls, reconnect, cancelled tab closure with the same player ID and seat, confirmed reload, Escape pause and explicit leave. The default port 5174 was occupied by a separate dev server without a backend URL, so it was left untouched.

The production-preview smoke also verifies the real leave dialog, cancellation/resume, Escape handling and guard removal. Client/server type checks and builds passed. There are 352 passing unit/backend cases across the full suite and final targeted checks, including 31 capture/leave-guard cases.

A headed native capture attempt on this Mac was blocked at pointer capture, consistent with the existing opt-in test limitation. Native Windows/Brave shortcut delivery is therefore still unverified. The next Windows playtest should cover Ctrl+W while crouching, the tab close button with both Stay and Leave, a short Escape tap, a two-second Escape hold, and Resume in the affected browsers. This section records pre-deployment verification; production rollout evidence is recorded separately under `load-results/`.
