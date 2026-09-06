# Burnhop

A shooting range and eight-player Outpost free-for-all with jet boots. Made with TypeScript, React, Vite, Canvas 2D and an authoritative Colyseus server. The browser game stays on Vercel.

## Run it

Use Node **22.18 or later within 22.x** and pnpm **11.3.0** (the exact tested dependency versions are pinned). Run `nvm use` first.

```sh
pnpm install
pnpm dev
```

Open **http://localhost:5173**. The branded **BURNHOP** entrance introduces your customized pilot doing an unarmed dance against the moonlit desert. **Enter game** requests fullscreen and reveals the main menu with a usable cursor. The optional entry sound button starts the beat after a deliberate gesture; reduced motion keeps the pilot still. Choose a map card and press **Enter practice** to capture the mouse, load that arena, and start a solo session. Solo practice needs no account or backend.

**Multiplayer** creates or joins an unlisted 2–8-player Outpost room. Enter a nickname, share the invite, load the map, and mark ready. The host starts a three-second countdown followed by five minutes of free-for-all. Kills decide the result; equal leaders draw. The server owns combat, respawns, scores, time and host transfer. Guest sessions recover for 30 seconds after a lost connection or refresh. Online menus neutralize controls while the match continues. Read [the deployment and verification runbook](docs/multiplayer-release.md) for local multiplayer, hosting settings and release gates.

Fullscreen is required for the entire game, including the menu, settings and character studies. Leaving fullscreen pauses gameplay and shows a persistent **Return to fullscreen** screen. Returning restores the current screen; a paused practice session still requires **Resume**. Browsers that cannot grant fullscreen remain on the entrance with an explanation and retry; there is no windowed-play option.

Tap Escape to pause and free the cursor while retaining fullscreen where supported. Hold Escape continuously for about **2 seconds** to exit fullscreen, or use **Exit fullscreen** in pause. A small progress bar appears during the hold; releasing early cancels, and repeated taps do not exit. Browsers with Keyboard Lock support this tap/hold distinction; other browsers may exit fullscreen immediately. The browser's own emergency exit remains available. Resume requires an explicit click. Returning to the main menu ends the practice session and keeps the fullscreen shell.

The interface uses charcoal, warm white, sage and restrained amber/red accents. The entrance retains its night sky, stars, moon, layered dunes and drifting wind; the same customized pilot dances in the menu backdrop. Reduced motion freezes both scenes. The persistent HUD separates a cyan jet-fuel gauge and red health strip on the left from equipment-driven ammunition rows on the right. Fuel has explicit low/empty states; each weapon shows its name, silhouette, rounds, capacity, reserve and reload progress. Health stays at 100 in safe practice and follows server-authoritative damage online. The controls guide stays collapsed until opened.

For the crouch pose study, open **http://localhost:5173/?preview=crouch** or expand **Studio** in the development menu and choose **Crouch preview**. Compare upright standing with a crouch, scrub the depth slider, replay the transition, flip facing, or show the leg joints. The small figures use the same scale as gameplay. Choose **Try in practice** to enter the practice flow and use the approved crouch in the range. Existing character colours carry into the preview. Reduced motion disables replay and makes stance buttons immediate; the slider remains available.

Choose **Customize pilot** from the menu to edit the detailed character. Face, hair, body build, clothing, equipment, and colours are independent. All 64 part choices are available immediately. Field, Scout, and Heavy outfits replace clothing and gear while keeping your face, hair, and build. Changes apply and save automatically in this browser. **Saved looks** stores complete snapshots: save new, restore, update, rename, delete, or undo the last deletion. Editing the active appearance does not change a saved snapshot, and naming a look does not change the pilot's callsign. If local storage is unavailable, the creator remains usable for the current visit.

For the **character study**, open **http://localhost:5173/?preview=character** or expand **Studio** in the development menu and choose **Character preview**. Its four sample looks are temporary inspection recipes for the same customizable character. Enlarged, portrait, and gameplay-size views share the completed renderer with the creator, menu, crouch study, player, and bot. Try aim/facing, standing/crouch/walk/jump/jet, frozen animation frames, joints, and **Show hit flash**. The study does not write or migrate settings. Reduced motion keeps playback off while preserving manual controls.

Use **Look up**, **Level**, **Look down**, or the **Look direction** slider to inspect aiming in either stance. The head and helmet tilt with aim while the torso leans slightly from the waist; the neck and near arm stay attached. The joint overlay also shows the waist and neck. This same upper-body response follows normal mouse aiming in practice. Head and torso rotation leave the stance's weapon pivot fixed; crouching lowers that pivot with the body. Reduced motion makes the look presets immediate.

The head turns progressively: a gentle nod near level grows to 60° at extreme up/down aim. The look buttons select the full vertical aiming extremes; the torso still leans by at most 6°.

With the development server running, `node scripts/review-crouch.mjs` checks preview controls, navigation, responsive layout, and reduced motion, and saves screenshots under `docs/screenshots/`.

`node scripts/review-character.mjs` checks the detailed preview, temporary settings, pose controls, and navigation. For the compiled preview, run `BURNHOP_PREVIEW_URL=http://127.0.0.1:4173 node scripts/review-character.mjs` after building and starting the production preview server.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

To run browser checks, install the test browser once with `pnpm exec playwright install chromium`, then run `pnpm test:e2e`. Playwright starts the development server automatically if necessary. Test artifacts are under `test-results/`; reviewed screenshots and verification notes are under `docs/`.

Native fullscreen/pointer-lock integration is opt-in: `BURNHOP_NATIVE_CAPTURE=1 pnpm exec playwright test tests/capture.spec.ts --headed -g "native fullscreen"`. The bundled automation Chromium on this machine rejects even isolated pointer-lock requests with `WrongDocumentError`; the default suite exercises fullscreen-only entry, required fullscreen gating, denied/unsupported capture, gameplay, and resume with observable browser API fixtures. Native entry, practice capture, pause, gate recovery, and explicit resume were previously verified manually in Arc. The two-second Escape hold and cancellation paths are covered by controlled-clock browser tests in `tests/escape-hold.spec.ts`.

For the production smoke check, first run `pnpm build` and `pnpm preview --host 127.0.0.1 --port 4173`, then run `node scripts/smoke-production.mjs` in another terminal. The smoke check requires the preview server to be running.

See `docs/verification.md` for recorded verification evidence, observed frame timing, and coverage limits. Re-run the commands above after changes to check the current build.

## Camera and controls

The camera follows tightly toward the pilot's center, with a little smooth trailing movement. It stops at the arena edges, so the pilot can leave center near the floor and boundaries. Crouching keeps the same feet-based camera anchor.

Press **Tab** to cycle the view ranges allowed by the equipped weapon. Pistols, revolvers and every dual loadout use **1x**; UZI/UMP allow **1x–1.5x**; AK-47/M416 allow **1x, 1.5x, 2x and 2.5x**; the sniper also allows **4x**. Higher labels show more arena with a smaller pilot; they are view-range tiers, not optical magnification. The corresponding world scales are 1.5, 1.35, 1.2, 1.1 and 0.75. The obsolete 3x/5x options are removed. Equipment changes clamp the current tier immediately. Pause/resume preserves it; a new practice session or restart resets to the pistol and 1x. The lower-left readout explicitly says **View range**.

Graphics default to **Balanced** at a **120 FPS limit**. Existing saved preferences are preserved; reset controls and graphics in Settings to adopt the current defaults.

Choose **Settings & Controls** from the main menu or **Settings** while paused. Bindings, aim style, sound, and motion preferences save automatically in this browser. Editing settings during practice preserves the paused session; return to the pause screen and deliberately resume to recapture the mouse.

| Default input | Action |
| --- | --- |
| A / D | Move |
| C / Down arrow | Crouch |
| Space | Jump / early hop |
| Left or right Shift | Jetpack thrust |
| Left mouse | Fire |
| Right mouse | Switch to the alternate aim style |
| R | Reload |
| F | Equip the nearby weapon alone |
| Q | Pair a nearby compatible pistol/SMG |
| E | Punch |
| Tab | Cycle the equipped weapon's view range |
| Escape | Tap to pause; hold about 2 seconds to exit fullscreen |
| F3, development only | Physics/performance overlay |

Each action supports a primary and secondary keyboard or mouse-button binding. Middle and side mouse buttons are supported. Conflicts show the proposed swap before changing either action; empty-slot swaps identify any action becoming unbound. Escape always pauses and F3 remains reserved for diagnostics. While assigning a binding, Escape cancels and Tab is assignable; elsewhere in settings, Tab moves focus normally. Keyboard combinations, the mouse wheel, and gamepads are not part of this control scheme.

Movement, crouching, firing, aim switching, and jetpack activation can each use **Hold** or **Toggle**. All default to Hold. Toggle movement switches direction when you tap the opposite direction and stops when you tap the active direction again. Toggle firing remains active through a manual reload until switched off. Pause, focus/capture loss, restart, or control changes clear active inputs and toggles; resuming requires a fresh activation.

Choose **Aim line** or **Crosshair** as the default. The aim-switch binding activates the other style while held, or toggles between them. The default is the pointer crosshair. Both modes share the latest aim angle, and firing remains independent. Default aim follows the latest mouse input every rendered frame. The line is 56 world pixels long, beginning 149.6 world pixels from the weapon pivot; a six-screen-pixel radius around the pivot retains its latest angle to prevent jitter. The crosshair follows the mouse position. Zoom keeps the pointer's screen position stable, and projections include the current camera, zoom, letterboxing, and display density.

During mouse capture, relative mouse movement controls a virtual pointer inside the playfield, so the system cursor cannot leave for another monitor. A stationary pointer continues to aim at the same screen position as the character moves. Input resets restore the configured default aim style.

**Combined jump / jetpack** preserves the original Space sequence. The first press jumps; releasing and pressing again airborne engages the boots. With Toggle selected, the airborne activation remains on after release, and another press stops thrust without queuing a hop. Grounded/coyote jumps still take priority, and a descending press within the 150 ms landing window queues an early hop. A missed landing can turn that pending combined intent into thrust.

**Separate jump / jetpack** is the default, with Space for jump and either Shift key for thrust; both can be remapped. The jetpack binding can launch directly from the ground or thrust airborne. Jump inputs still queue early hops, but never turn into thrust. Simultaneous jump and jetpack inputs combine the normal jump impulse with thrust. Landing or empty fuel stops jetpack Hold/Toggle activation and requires a fresh press; refilling fuel does not restart thrust automatically.

The bottom-right FPS readout measures rendered frames over the latest half-second and refreshes four times per second. It shows a dash before gameplay starts and while paused. Immersive play starts only after both fullscreen and pointer capture succeed and assets have loaded. Losing either pauses the game; losing only pointer capture preserves fullscreen. Resume requires a new click to recapture. Unsupported or denied fullscreen leaves the persistent entry gate in place. Denied pointer capture returns to the existing fullscreen menu with a retry message. No windowed path can start gameplay.

With combined controls selected, the second Space press activates thrust in midair, except while descending toward a landing within 150 ms: that press queues a hop on contact instead. The hop survives releasing Space, preserves horizontal momentum, and uses no fuel. Holding the original jump does **not** engage thrust or repeatedly jump. There is also approximately 130 ms of jump grace after leaving a ledge. If steering takes a buffered hop away from its landing, holding Space activates thrust when the buffer expires.

Holding **C** or **Down arrow** on the ground lowers the body with planted feet over approximately **0.18 seconds**. The collider follows the pose from **68** to about **54.2 world pixels** high, and full crouch walking is **160 px/s**, half the normal speed. Releasing both keys returns to standing when there is room overhead; a low ceiling keeps the character crouched until it clears. Jumping and airborne movement release crouch without changing jump or jetpack power or air speed. Crouch resumes after landing if a crouch key remains held and Space is released. The gun, aim indicator, and shots use the lowered stance's shared weapon origin. Pausing clears held input while preserving the physical pose; standing clearance is checked again when play resumes.

A full tank provides **3.5 seconds** of continuous thrust (40% longer). Engine acceleration is 3600 px/s² for the first 10% of fuel spent, then tapers linearly to 1800 px/s² at empty. This scales thrust, not velocity; gravity remains 1500 px/s² and the flight rise-speed cap remains 480 px/s. Power depends on remaining fuel, so tapping thrust does not reset the initial kick. At empty fuel, release and press again before the boot thrusters can restart. Fuel recovers on the ground or in the air after 0.4 seconds without thrust, taking approximately 3.3 seconds to refill.

This is a safe practice range: the bot takes damage and respawns; the player stays at full health. **Practice weapon** and **Second hand** in the pause menu let you inspect the same weapons and dual handling used online. Non-sniper reserves are unlimited, but every magazine requires reloading. The sniper begins with five loaded rounds and ten reserve rounds. The active appearance, named looks, and sound preferences stay in this browser.

Both practice maps also have permanent stations for all seven weapons: along the Practice range firing line and together beside the Outpost spawn in the western courtyard. Walk to a labeled gun and press **F** to equip it or **Q** to pair compatible weapons. Station weapons have unlimited reserves, including the sniper, and remain stocked after pickup and restart.

## Combat and pickups

Each multiplayer life starts with **100 HP and a 12-round pistol**. Weapons appear on six authored Outpost pads; there are no automatic weapon swaps. Move within 60 world pixels with a clear path, then use **F** to equip alone or **Q** to pair. Equipping alone drops both previous guns; pairing keeps the main gun and replaces any offhand. Pads refill after 20 seconds using a server-shuffled bag containing pistol, revolver, AK-47, M416, UZI and UMP once each. Death and replacement drops preserve their ammunition and cooldowns. Ordinary dropped guns last 15 seconds, with at most 16 retained; sniper drops last 30 seconds.

The following are initial tuning values from `src/game/weapons.ts`, intended to change with playtesting. Damage is per shot before range falloff, rounding and the target's remaining health.

| Weapon | Body damage | Head multiplier | Magazine | Shot interval | Reload | Maximum view range |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pistol | 18 | 1.75× | 12 | 0.20 s | 1.20 s | 1x |
| Revolver | 42 | 2× | 6 | 0.50 s | 2.20 s | 1x |
| AK-47 | 28 | 1.75× | 25 | 8 ticks / 0.133 s | 2.10 s | 2.5x |
| M416 | 23 | 1.75× | 30 | 7 ticks / 0.117 s | 1.90 s | 2.5x |
| UZI | 15 | 1.5× | 20 | 4 ticks / 0.067 s | 1.50 s | 1.5x |
| UMP | 20 | 1.5× | 25 | 0.10 s | 1.80 s | 1.5x |
| Sniper | 80 | 2× | 5 | 1.20 s | 3.00 s | 4x |

Leg hits use **0.75×** damage. Head/body/legs occupy the top 25%, middle 45% and bottom 30% of the shared stance collider, independent of clothing or body build. The AK has stronger recoil than the M416. UZI trades magazine life and distant accuracy for rapid close-range fire; UMP fires more slowly with higher damage per round and gentler spread. Range falloff, spread, recoil, recoil recovery and maximum shot distance are configurable alongside these values. The P90 is not included.

Dual wielding supports any pair drawn from **pistol, revolver, UZI and UMP**, including mixed weapons. Each gun sits in its own hand, with shot origins matching the visible grips. One aim and trigger drive two independent magazines and cooldowns. Short clicks alternate the starting hand; holding fire staggers the two guns. If the next hand is empty or cooling, the ready hand can fire without bypassing either cooldown. Each hand fires at two-thirds of its single-gun cadence, with 1.6× spread and 1.3× recoil, and the view is fixed at 1x. **R** reloads eligible magazines sequentially, main then offhand, blocking firing until the queue completes. The inactive gun is visibly stowed while its hand reloads the other. Rifles and the sniper are single-weapon equipment. Equipping imposes a 0.3-second handling delay. Practice displays an explanation if Q cannot pair the nearby weapon.

A sniper supply drop is scheduled at **45, 135 and 225 seconds**, with an eight-second warning and a visible descending capsule. It is skipped if a sniper is already held by a living player or available on the map. Its five-round magazine and ten-round reserve, slow cycling, three-second reload and limited availability balance its high damage and wider view.

Every pilot can punch with **F**: 20 damage, 56-world-pixel reach, a 0.1-second windup and 0.6-second cooldown. A punch hits at most one opponent inside its forward cone and cannot pass through terrain. It applies a 220 px/s horizontal knockback impulse and an 80 px/s upward impulse, cancels reload and briefly blocks firing. Shooting or starting a punch immediately ends spawn protection. Ordinary multiplayer respawn remains two seconds, followed by one second of protection.

Authoritative damage triggers a short red screen-edge effect; low health enters at 25 HP and clears above 30 HP. Confirmed kills trigger a brief blue effect and their own sound. Feedback intensity and heartbeat can be adjusted in Settings; reduced motion keeps the warning steady. Death produces six clothed toy-like pieces using the victim's appearance, with three complete groups at low quality. Reduced motion uses a short, stationary collapsed-pilot fade. These are local cosmetic effects with terrain-only collisions, bounded counts and a 2.5-second maximum lifetime; they never obstruct players or affect hits.

## Menu audio

An original **112 BPM dhol-inspired instrumental loop** accompanies the entry/menu dance at **10% music volume by default** after a deliberate sound or entry gesture. It continues through the menu's settings, customization and studies, and pauses during loading, gameplay (including the practice pause menu) and hidden tabs. Returning to the menu resumes its musical position. The loop is synthesized locally without downloaded samples; the pilot uses the same musical clock. The entrance starts silent until the first deliberate click, in keeping with browser audio policies.

Main-menu and pause-menu buttons have soft hover and click cues. Keyboard Tab navigation uses the hover cue, and Enter/Space activation uses the click cue. Disabled buttons and touch hover stay silent. The menu speaker button and **Settings → Audio → Master sound** mute both music and effects, and that choice persists across reloads. The dedicated **Audio** tab offers 0–100% sliders for master, menu music, weapons/reload, movement/jetpack, combat feedback and menu effects. Changes apply immediately, including to a paused session, and save automatically. **Reset audio to defaults** resets only these levels; reduced motion has its own **Motion** tab. Audio failures never block entry or gameplay.

Weapon silhouettes, firing profiles and reload cues distinguish all seven guns. Magazine and cylinder handling follow each weapon's simulation reload progress, so pausing freezes the sequence and resuming continues it. Grounded travel drives footstep cadence; crouching is quieter and slower, landings respond to impact speed, and the jet uses layered air and engine sound. Melee impacts, terrain/body impacts, pickup/drop notices and confirmed kills have dedicated feedback; voice limits keep overlapping combat bounded.

## How it is built

`src/game/simulation.ts` advances one 1/60-second actor tick from serializable commands. It knows nothing about React, audio, the browser or rendering. Movement tuning lives in `CONFIG`; `src/game/weapons.ts` owns weapon, dual and melee tuning; `src/game/combat.ts` shares hit regions, range damage and melee geometry. The same combat functions serve practice, client prediction and server authority. `src/multiplayer/pickups.ts` owns authoritative acquisition, while `pickupConfig.ts` supplies its tuning.

`src/game/runtime.ts` maps browser input to commands and feeds the fixed-step clock. It owns aim mode, the virtual pointer, independent mouse-button state, cleanup, pause/focus handling, interpolation snapshots, FPS measurement, and the HUD subscription. The action resolver in `src/game/input.ts` converts physical buttons, toggle intent, and press pulses into simulation commands. Aim style and zoom stay in presentation; the simulation receives `InputCommand.aimAngle` and an optional explicit combined/separate jetpack intent. Omitting the jetpack object preserves legacy command behavior. React owns the screens and explicit entry flow around a persistent fullscreen shell and canvas; `src/game/capture.ts` manages fullscreen, pointer-lock, optional Escape keyboard lock, and cleanup. The entrance calls `enterMenu()` for fullscreen only; practice entry requests pointer lock in a later click. The runtime is created only after deliberate practice entry and loading, and destroyed when returning to the main menu. The development-only `window.__BURNHOP__` exposes read-only simulation snapshots, visual aim, capture state, coordinate projection, and frame metrics for playtesting.

`src/game/renderer.ts` draws the world; `detailedCharacter.ts` is the shared character renderer, using the articulated skeleton and aim transforms in `character.ts`. Both legs swing from the hips, with stride driven by signed movement speed, including backward walking and crouch walking. Sole-mounted thrusters and exhaust share the animated boot positions; reduced-motion mode keeps stable flames without exhaust trails. The gun and dash resolve the latest pointer against the interpolated character and updated camera on every rendered frame, including frames between simulation ticks. Shooting still consumes the latest input on the fixed simulation tick. Character parts and the seven weapons in `weaponArtwork.ts` are original Canvas vectors with named materials; no character sprites or colour variants are decoded while rendering. `deathFragments.ts` reuses individual dressed parts for bounded cosmetic physics. Environmental SVG artwork, arena data, fonts, and runtime modules report real loading progress and support Retry. Gameplay audio combines bundled CC0 recordings and weapon-specific synthesized profiles, with local jet air/engine layers and sample-load fallback. Button effects and the dance instrumental are synthesized locally. `src/game/menuAudio.ts` owns the menu music clock and button tones; `src/useMenuAudio.ts` connects it to the persistent React shell, browser visibility, settings and accessible button interactions. It is separate from the practice runtime so returning to the menu does not destroy its audio.

`src/game/stance.ts` shares pose offsets, collision height, and the weapon origin between simulation and rendering. The approved artwork uses a uniform gameplay scale of `68 / 85.94`; the crouch lowers connected joints without squashing the artwork. The player's collision rectangle changes height from the feet and checks solids before expanding. The target retains its existing collision shape. All three body builds share these dimensions and joint anchors. Bindings and Hold/Toggle preferences change input interpretation without changing movement speed, collision geometry, or fuel tuning.

Version 3 settings add normalized control preferences alongside typed appearance identifiers and named full-look snapshots in `burnhop-settings`. Version 2 saves migrate without losing appearances, saved looks, sound, or motion preferences. `src/game/settings.ts` migrates the previous numeric cosmetic fields and the legacy `low-altitude-settings` fallback, preserving sound, reduced motion, and the original Olive/Sand/Slate colours. Unknown identifiers fall back per part; unavailable storage never blocks play. The default aim style is saved; temporary alternate-aim activation, session zoom, and character-study selections are not.

The menu's **Choose your arena** cards offer **Practice range** and **Outpost** directly above **Enter practice**. The selected card has a checkmark and red border; the launch button repeats the selected map and solo-session mode. Select Outpost and press **Enter practice**, or open **http://localhost:5173/?map=outpost** to preselect it. Fullscreen and mouse capture still start through deliberate clicks. Switching arenas starts a new practice session; pausing, resuming, and restarting keep the current map. **Tab** cycles the equipped weapon's permitted view range. Use crouch through the narrow western tunnel. Falling below the islands in practice returns you to the western courtyard while preserving your ammunition and practice results.

Outpost recreates the classic Mini Militia terrain arrangement with original Canvas artwork: both bunkers, floating islands, the central rise, eastern sky ramp, and lower tunnel. Its simplified contours are scaled by 1.4 for this game's pilot. `public/assets/arena.json` defines the original range; `public/assets/outpost.json` defines Outpost's 16 terrain contours, eight named player spawns, six ordinary pickup pads and one sniper pad. See [map notes and references](docs/maps/outpost.md) for fidelity differences and source links. Run `node scripts/build-outpost.mjs` to regenerate Outpost data and the selector preview after editing its authored coordinates.

`src/game/collision.ts` shares deterministic polygon collision between movement, shots, crouch clearance, and landing prediction. Static Outpost artwork is cached by `src/game/outpostRenderer.ts`; its visible contour boundaries come from the same map data. Rock, concrete and wood have material detail cached at up to 3× resolution according to zoom and display density, with a 128 MiB terrain cache budget. The bunker roof lips provide clearance for crouching through both directions while retaining standing-height collision. `src/game/types.ts` describes the integration boundary. `docs/prototype-plan.md` preserves the accepted product/technical plan.

The Colyseus server owns the private 2–8-player match, hit resolution, pickups, health and scores. Client prediction restores both complete weapon instances and movement state before replaying pending commands. Compatibility revision **`burnhop-3:gameplay-3`** fingerprints movement, weapon/dual/melee/acquisition tuning, hit-region proportions and the bundled map. Browser/server releases must advertise the same full identifier. Current validation measurements and rollout status belong in the separate verification and multiplayer release records; this feature description does not establish production deployment.

## Learning route

Read `types.ts`, then the movement section of `simulation.ts`, then `timing.ts`, and finally the input/render loop in `runtime.ts`. Try changing ground braking before changing maximum speed: stopping distance has a surprisingly large effect on how responsive movement feels.
