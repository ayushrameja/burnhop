# Multiplayer architecture

Burnhop serves its existing React/Canvas game from Vercel at `https://burnhop.lowhp.studio/`. A single Colyseus process in Frankfurt owns one private Outpost room with 2–8 guests. The initial release keeps all room state in memory; restarting the backend ends its rooms. No database or player account is required.

## Code boundaries

| Location | Responsibility |
| --- | --- |
| `src/game/simulation.ts` | Pure actor movement, stance, fuel and rifle timing; cached terrain collision; existing practice adapter. |
| `src/game/arenaValidation.ts` | Browser-independent authored geometry validation. |
| `src/multiplayer/model.ts` | Plain TypeScript match, input and event contracts; match rules. |
| `src/multiplayer/map.ts` | Bundled, validated, immutable Outpost JSON and build compatibility identifier. |
| `src/multiplayer/prediction.ts` | The actor step used by client prediction and authoritative matches. |
| `src/multiplayer/match.ts` | Lobby/countdown/match/results lifecycle, spawning, hitscan, health and scoring. |
| `src/multiplayer/wire.ts` | Colyseus schemas and explicit conversion between wire fields and nested actor state. |
| `src/server/BurnhopRoom.ts` | Session admission, one-input-per-player tick, snapshots, rewind, reconnection and room cleanup. |
| `src/online/` | Guest session recovery, client prediction, remote interpolation and event deduplication. |

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

Each server tick steps each player once. Receiving several packets together cannot grant extra movement or shots. The brief input-gap bridge never repeats jump presses, reload presses or firing; extended gaps and disconnected players receive neutral intent. Discarding a queue must also discard its held intent. Colyseus acknowledges discarded inputs so their effects do not replay indefinitely.

Colyseus's fixed-step input handle provides sequence acknowledgements and clock synchronization. The browser predicts its local actor immediately with the same pure step, then restores authoritative fields and replays unacknowledged commands. Restoration includes velocity, grounded/coyote/jump-buffer state, crouch size, fuel delay, jet latch, ammunition, reload and cooldown timers. Historical replay reads the recorded world aim and commands; it does not sample current controls or play effects.

Other players render from buffered snapshots. Camera, cursor, aiming and HUD presentation remain local. Online pause/capture/focus loss releases input while the server continues. Reconnection and new lives discard old prediction; resuming control requires fresh input. Practice retains its existing pause behavior.

The room uses its monotonic clock for match/countdown deadlines, so a dropped physics catch-up step cannot extend a five-minute round.

## Combat and lives

The server owns health, ammunition, damage, kills and deaths. A shot starts at the actor's stance-dependent weapon origin and is clipped against immutable terrain. It then tests historical target rectangles, including crouch height and life identity. Terrain wins equal-distance intersections. A rectangle from an earlier life cannot hurt a newly respawned player. Spawn protection is current authoritative state and ends immediately when its owner fires.

All eligible shots in a tick are collected before damage is applied, allowing trades. Players pass through each other. Death respawns after two seconds at the valid authored spawn farthest from living opponents; authored spawn order breaks ties. Falling awards a death without a kill. A disconnected dead player waits for reconnection before respawning. Host priority follows continuous connection time; a returning guest moves behind peers who stayed connected.

Event IDs deduplicate delivery. Actor ID, life ID and input ID correlate predicted movement/reload cues; shot ID correlates speculative shots with confirmation. Only an authoritative hit belonging to the local shooter can show its hit marker.

## Compatibility and tuning changes

`COMPATIBILITY_ID` combines an explicit protocol revision, explicit gameplay revision, a fingerprint of actor tuning in `CONFIG`, and a fingerprint of the authored Outpost JSON. It is checked before joining and exposed by `/health`. The map is bundled into the server; gameplay never fetches Vercel map data from the backend.

When editing wire fields, bump the protocol revision. When editing simulation, match rules, stance behavior or collision logic, bump the gameplay revision—even if the numeric `CONFIG` checksum remains unchanged. Editing the authored map changes its fingerprint automatically. Deploy compatible backend and frontend builds together; the frontend must use the map belonging to its advertised compatibility ID.

Keep cosmetic recipes independent of collision dimensions. Change latency settings only after testing prediction, cover and rewind behavior over the actual WebSocket path. More rewind tolerates more delay but also permits older views of a target near cover; it cannot remove international network latency.

## Verification evidence

Unit tests cover practice parity, match lifecycle, eight-player admission, deterministic spawning, trades, cover and prior-life rejection, plus prediction corrections through buffered jumps, jet toggles, fuel depletion, low ceilings and reloads. The backend suite uses actual SDK WebSocket connections.

`pnpm build:loadtest` builds the eight-client harness. For the selected instance, run:

```sh
node dist-tools/loadtest.mjs --endpoint https://de-fra-24270fd2.colyseus.cloud --seconds 900
```

It creates one room, drives eight moving/firing guests at 60 Hz, automatically readies/starts/rematches, and counts 900 seconds of gameplay with all eight connected. It leaves its slots on exit and writes an ignored `load-results/*.json` report. Do not run it while a human room occupies the instance. Short `--seconds` runs are smoke tests and never pass the full duration or memory-stability gate.

The report checks rolling p99 simulation work below 16.7 ms, RSS below 750 MB (750,000,000 bytes), sustained queue/schedule backlog, and late-run memory trend. It records the precise stability/backlog criteria and per-client activity. Actual movement must appear in at least 40% of each bot’s alive state samples; mandatory death/respawn waiting time stays visible in total observations but does not count as idle play. This harness does not emulate packet loss: apply latency, jitter and TCP loss to an isolated Linux socket path separately. A successful scripted run still does not validate the real Canada–India player connection; that requires the final human playtest.

## Smoothness and local diagnostics

State patches target 45 Hz while simulation/input remain 60 Hz. The SDK binds the canonical 80 ms interpolation delay to input render-time stamps consumed by `rewind.lastSeenBy`; do not override remote field delays independently. The 250 ms maximum rewind is unchanged. The wire schema is unchanged, and older clients continue supplying their own view timing.

Match admission freezes flat cosmetic recipes. Wire conversion caches normalized appearance per source object/string and serialization per frozen recipe using weak references; mutable recipes still serialize normally. Playing-state React snapshots coalesce to 10 Hz while the canvas reads the live schema. Phase changes publish immediately; score/timer updates may wait up to 100 ms. Spawn-view terrain textures are prepared progressively in the lobby using the existing 128 MiB cache and current display density. Preparation stops when gameplay starts or the runtime is destroyed; distant terrain and later zoom-density changes can still require baking.

Open with `?diagnostics=1` (or append `&diagnostics=1` to an invitation) and inspect `window.__BURNHOP_ONLINE__.snapshot().performance` in browser developer tools. Nothing is uploaded. Arrival interval/jitter (standard deviation) and frame p95/p99 use bounded 300-sample windows. Arrival timing measures decoded state delivery, so browser scheduling can affect it too. Slow frames exceed 33.33 ms and are counted only during active visible play. Spatial correction frequency counts shifts over 0.5 world units after reconciliation and replay at the same input horizon, excluding paused/dead play and input epoch changes. Counters last for the connection. The older top-level `correction` vector is prediction lead over the last authority snapshot, not this correction metric.
