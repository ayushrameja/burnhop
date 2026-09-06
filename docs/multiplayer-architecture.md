# Multiplayer architecture

Burnhop serves its existing React/Canvas game from Vercel at `https://burnhop.lowhp.studio/`. A single Colyseus process in Frankfurt owns one private Outpost room with 2–8 guests. The initial release keeps all room state in memory; restarting the backend ends its rooms. No database or player account is required.

## Code boundaries

| Location | Responsibility |
| --- | --- |
| `src/game/simulation.ts` | Pure actor movement, stance, fuel, per-hand weapon/reload timing, punch windup and knockback; practice adapter. |
| `src/game/weapons.ts` / `combat.ts` | Shared weapon, dual and melee tuning; instances, spread, hit regions, range damage and attack geometry. |
| `src/game/arenaValidation.ts` | Browser-independent authored geometry validation. |
| `src/multiplayer/model.ts` | Plain TypeScript match, input and event contracts; match rules. |
| `src/multiplayer/map.ts` | Bundled, validated, immutable Outpost JSON and build compatibility identifier. |
| `src/multiplayer/prediction.ts` | The actor step used by client prediction and authoritative matches. |
| `src/multiplayer/match.ts` | Lobby/countdown/match/results lifecycle, spawning, hitscan/melee resolution, health and scoring. |
| `src/multiplayer/pickups.ts` / `pickupConfig.ts` | Server-owned supply bag, pickup arbitration, dropped instances and sniper schedule. |
| `src/multiplayer/wire.ts` | Colyseus schemas and explicit conversion between wire fields and nested actor state. |
| `src/server/BurnhopRoom.ts` | Session admission, one-input-per-player tick, snapshots, rewind, reconnection and room cleanup. |
| `src/online/` | Guest session recovery, client prediction, remote interpolation and event deduplication. |
| `src/game/weaponArtwork.ts` / `deathFragments.ts` | Weapon silhouettes and bounded dressed debris; client presentation only. |

The server/shared TypeScript build excludes DOM libraries. Browser image types live separately in `src/game/assets.ts`. Vercel still builds static `dist/`; the Node server builds independently to `dist-server/index.mjs`. Both use Node 22.18 or later within 22.x and pnpm 11.3.0.

## Simulation and network timing

| Setting | Initial value |
| --- | --- |
| Simulation and input rate | 60 Hz |
| State patch rate | 45 Hz |
| Remote interpolation delay | 80 ms |
| Maximum hitscan rewind | 250 ms |
| Input queue capacity | 32 frames per player |
| Server resync threshold | More than 15 queued frames |
| Short input-gap bridge | Up to 6 ticks; held movement/stance/jet intent only |
| Match duration | 300 seconds |
| Countdown / respawn delay / spawn protection | 3 / 2 / 1 seconds |
| Reconnection reservation | 30 seconds |
| Inactive lobby expiry | 10 minutes |

Each server tick steps each player once. Receiving several packets together cannot grant extra movement or shots. The brief input-gap bridge never repeats jump, reload, equip, pair or punch presses, or firing; extended gaps and disconnected players receive neutral intent. Discarding a queue must also discard its held intent. Colyseus acknowledges discarded inputs so their effects do not replay indefinitely. The transport session supplies actor identity; the client submits intent, never damage, health or an inventory grant.

Colyseus's fixed-step input handle provides sequence acknowledgements and clock synchronization. The browser predicts its local actor immediately with the same pure step, then restores authoritative fields and replays unacknowledged commands. Restoration includes velocity, grounded/coyote/jump-buffer state, crouch size, fuel delay, jet latch, both complete weapon instances, equip/fire locks, punch state and knockback impulses. Weapon identity, instance identity, ammunition/reserve, reload/cooldown/queue state, shot counters, recoil and bloom all round-trip through the flat wire schema. Historical replay reads recorded aim and commands; it does not sample current controls or play effects. Pickup ownership remains authoritative and enters prediction through the next reconciled state.

Other players render from buffered snapshots. Camera, cursor, aiming and HUD presentation remain local. Online pause/capture/focus loss releases input while the server continues. Reconnection and new lives discard old prediction; resuming control requires fresh input. Practice retains its existing pause behavior.

The room uses its monotonic clock for match/countdown deadlines, so a dropped physics catch-up step cannot extend a five-minute round.

## Combat and lives

The server owns health, equipment, ammunition, damage, kills and deaths. Every life begins at 100 HP with a full 12-round pistol. The other weapons are revolver, AK-47, M416, UZI, UMP and the special sniper; P90 is not included. Initial values live in `WEAPONS` (also exported as `WEAPON_CONFIG`) and are summarized in the README. Non-sniper reserves are unlimited; the sniper has five loaded and ten reserve rounds. Reloading never restores more ammunition than remains in a finite reserve.

A shot carries its actual simulated origin and direction, including deterministic spread/recoil and its hand-specific muzzle. Terrain clipping and hit resolution both use that same ray. Spread is derived from an authority-created weapon instance and its shot counter, not a client-selectable input ID. The server tests historical target rectangles, including crouch height and life identity. Head/body/legs divide that rectangle into 25%/45%/30% height bands. A nearest-intersection query chooses one region; an exact region boundary selects the lower-damage region. Body damage is multiplied by the weapon's head factor or the universal 0.75 leg factor, reduced by configured linear range falloff, rounded and clamped to remaining health. Cosmetic body builds and animations never change these hit regions.

Terrain wins equal-distance intersections, using a 1e−8-world-unit tolerance for floating-point differences between polygon and rectangle arithmetic. Shot events retain the canonical ray distance rather than reconstructing it from the endpoint. A rectangle from an earlier life cannot hurt a newly respawned player. Spawn protection is current authoritative state and ends immediately when its owner fires or begins a punch.

All eligible shots and completed punches in a tick are collected before damage is applied, allowing trades. A punch uses current authoritative target positions, a 56-pixel forward cone, 20 damage, six windup ticks and a 36-tick cooldown; it hits at most one target and obeys terrain occlusion with the same contact tolerance. Its 220 px/s horizontal and 80 px/s upward impulses are simulation state, reconciled with movement. A fixed linear decay clears one impulse in 0.18 seconds; simultaneous punches add, so stacked impulses can take longer. Punching cancels reload and applies a 12-tick firing lock.

Players pass through each other. Death drops the victim's weapon instances and respawns after two seconds at the valid authored spawn farthest from living opponents; authored spawn order breaks ties. The new life receives the pistol, no offhand and one second of protection. Falling awards a death without a kill. A disconnected dead player waits for reconnection before respawning. Host priority follows continuous connection time; a returning guest moves behind peers who stayed connected.

Event IDs deduplicate delivery. Actor/life/input identity correlates predicted movement and punch cues; weapon instance and hand distinguish reload cues. Shot IDs include actor, life, weapon instance, hand and shot counter so simultaneous dual shots do not suppress one another. Only an authoritative hit belonging to the local shooter can show its hit marker, and kill feedback uses the authoritative killer ID.

## Weapon acquisition and dual wielding

The map generator authors six ordinary pads and one central high sniper pad. The shared validated JSON bundles the same coordinates in both builds. Pad coordinates describe center X and ground Y; the pickup wire position is 18 world pixels above the surface. A server-owned shuffled bag contains pistol, revolver, AK-47, M416, UZI and UMP once each and refills when empty. Ordinary pads receive a new bag item 1,200 ticks (20 seconds) after collection. There are no automatic timed equipment swaps.

`E` submits equip-alone intent and `Q` submits pair intent. The server checks living/connected status, a 60-pixel center-distance reach and terrain line of sight. It freezes each player's nearest candidate before transferring anything, then resolves competition by distance, joined order and player ID. If both actions arrive in one input, equip-alone wins. A dropped replacement cannot be collected in that same tick. The client highlights its nearby candidate and shows the configured key labels; the server still decides ownership.

Equipping alone replaces and drops both current guns. Pairing keeps the main gun and replaces/drops any previous offhand; both main and incoming weapon must be pistol, UZI or UMP. Same-weapon and mixed pairs are supported. Revolvers, AK-47, M416 and sniper cannot pair. Transfers preserve weapon instance identity, ammunition, reserve and remaining cooldown while canceling reload; an 18-tick equip delay prevents immediate swapping shots. Non-sniper dropped guns expire after 900 ticks, with the oldest removed above a cap of 16. Dropped sniper instances expire after 1,800 ticks.

One trigger and aim drive both hands. The offhand starts staggered; each weapon maintains its own ammo and cooldown. Dual cooldowns are 1.5× their single values, spread is 1.6× and recoil is 1.3×. Reload queues eligible magazines main-first and then offhand, blocking firing until complete. The visual rig stows the inactive gun and uses its free hand to work the other magazine. The HUD exposes both reload clocks and reserves.

The sniper is scheduled at 45, 135 and 225 elapsed seconds, with an eight-second warning. A scheduled drop is skipped if any living actor holds a sniper or one is already available on the map; it is not queued for later. Unclaimed supply lasts 30 seconds. All pickup availability, weapon identity and timers are wire state, so refresh/reconnection observes current supply. Match start resets the supply bag/pads/schedule; returning to the lobby removes match pickups.

## View and cosmetic feedback

View range is local presentation: larger tiers show more arena. Pistol/revolver and all dual loadouts are fixed at 1x; UZI/UMP allow up to 1.5x, AK-47/M416 up to 2.5x, and sniper up to 4x. Tab cycles only allowed tiers from 1, 1.5, 2, 2.5 and 4; equipment changes immediately clamp the current tier. These replace the old 3x/5x labels and retain the wider-view interpretation. Weapon timing, damage and range remain independent of camera scale.

Confirmed damage drives a 0.24-second restrained red edge effect; a confirmed kill drives a 0.3-second blue effect. Damage takes priority when both occur. The low-health warning enters at 25 HP and clears above 30 HP, with configurable intensity/heartbeat and a steady reduced-motion variant. Weapon/reload/melee/impact/kill sounds consume deduplicated presentation events; replay never plays them again.

Death events contain frozen stance/aim, appearance, velocity, impact direction and a cosmetic seed. A bounded local cache adds the last actually rendered gait, recoil and per-hand reload pose only when its actor and life ID match; otherwise the authoritative stance/aim is sufficient to build the effect. These immutable pose copies are removed with departed actors and presentation teardown. Each client builds six dressed fragments, or three complete groups on low effects (head, torso with both arms and fuel pack, both legs), with simple terrain-only physics. The pool caps at 48 (24 on low); fragments settle for up to two seconds and fade by 2.5 real seconds. Long render hitches cannot extend lifetime. Reduced motion keeps those groups together as a stationary collapsed pilot during a short fade. Respawn resets local camera/prediction while preserving existing fragments; match teardown clears them. Fragment positions, rotations and collisions are never sent over the network and cannot affect gameplay.

## Compatibility and tuning changes

`COMPATIBILITY_ID` now begins **`burnhop-2:gameplay-2`**, followed by fingerprints of gameplay tuning and authored Outpost JSON. Tuning includes `CONFIG`, `WEAPONS`, `DUAL_CONFIG`, `MELEE_CONFIG`, `WEAPON_HANDLING`, `PICKUP_CONFIG` and hit-region proportions. The identifier is checked before joining and exposed by `/health`; clients advertising the earlier wire/gameplay revision are rejected with a refresh message. The map and pickup pads are bundled into the server; gameplay never fetches Vercel map data from the backend.

When editing wire fields, bump the protocol revision. When editing simulation, match rules, stance behavior or collision logic, bump the gameplay revision—even if the numeric `CONFIG` checksum remains unchanged. Editing the authored map changes its fingerprint automatically. Deploy compatible backend and frontend builds together; the frontend must use the map belonging to its advertised compatibility ID.

Keep cosmetic recipes independent of collision dimensions. Change latency settings only after testing prediction, cover and rewind behavior over the actual WebSocket path. More rewind tolerates more delay but also permits older views of a target near cover; it cannot remove international network latency.

## Verification evidence

Unit tests cover practice parity, match lifecycle, eight-player admission, spawning, region/range damage, cover/prior-life rejection, gun/melee trades, pickup competition, instance transfer and sniper scheduling. Prediction tests restore both weapon states and verify deterministic shot identity, recoil, ammo and sequential reload replay alongside buffered jumps, jet toggles, fuel depletion and low ceilings. Presentation tests cover hand-specific effects, equipment HUD retention, fragment limits and real-time cleanup. The backend suite uses actual SDK WebSocket connections. Current run results and release measurements are recorded separately; these coverage descriptions do not establish deployment or a production capacity pass.

`pnpm build:loadtest` builds the eight-client harness. For the selected instance, run:

```sh
node dist-tools/loadtest.mjs --endpoint https://de-fra-24270fd2.colyseus.cloud --seconds 900
```

It creates one room, drives eight guests at 60 Hz through movement, pickups, varied weapons, dual fire, punching and reload, automatically readies/starts/rematches, and counts 900 seconds of gameplay with all eight connected. Its report includes acquired weapons, offhand shots and punches as well as core activity. It leaves its slots on exit and writes an ignored `load-results/*.json` report. Do not run it while a human room occupies the instance. Short `--seconds` runs are smoke tests and never pass the full duration or memory-stability gate.

The report checks rolling p99 simulation work below 16.7 ms, RSS below 750 MB (750,000,000 bytes), sustained queue/schedule backlog, and late-run memory trend. It records the precise stability/backlog criteria and per-client activity. Actual movement must appear in at least 40% of each bot’s alive state samples; mandatory death/respawn waiting time stays visible in total observations but does not count as idle play. This harness does not emulate packet loss: apply latency, jitter and TCP loss to an isolated Linux socket path separately. A successful scripted run still does not validate the real Canada–India player connection; that requires the final human playtest.

## Smoothness and local diagnostics

State patches target 45 Hz while simulation/input remain 60 Hz. The SDK binds the canonical 80 ms interpolation delay to input render-time stamps consumed by `rewind.lastSeenBy`; do not override remote field delays independently. The 250 ms maximum rewind is unchanged. The combat update extends the wire schema and requires the matching protocol/gameplay compatibility identifier.

Match admission freezes flat cosmetic recipes. Wire conversion caches normalized appearance per source object/string and serialization per frozen recipe using weak references; mutable recipes still serialize normally. Playing-state React snapshots coalesce to 10 Hz while the canvas reads the live schema. Phase changes publish immediately; score/timer updates may wait up to 100 ms. Spawn-view terrain textures are prepared progressively in the lobby using the existing 128 MiB cache and current display density. Preparation stops when gameplay starts or the runtime is destroyed; distant terrain and later zoom-density changes can still require baking.

Open with `?diagnostics=1` (or append `&diagnostics=1` to an invitation) and inspect `window.__BURNHOP_ONLINE__.snapshot().performance` in browser developer tools. Nothing is uploaded. Arrival interval/jitter (standard deviation) and frame p95/p99 use bounded 300-sample windows. Arrival timing measures decoded state delivery, so browser scheduling can affect it too. Slow frames exceed 33.33 ms and are counted only during active visible play. Spatial correction frequency counts shifts over 0.5 world units after reconciliation and replay at the same input horizon, excluding paused/dead play and input epoch changes. Counters last for the connection. The older top-level `correction` vector is prediction lead over the last authority snapshot, not this correction metric.
