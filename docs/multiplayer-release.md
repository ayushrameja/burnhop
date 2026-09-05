# Multiplayer development and release

The browser remains at https://burnhop.lowhp.studio/ on Vercel. The game server uses the existing Frankfurt Colyseus application **1879**, endpoint **https://de-fra-24270fd2.colyseus.cloud**. One PM2 fork, one unlisted room, up to eight players. This release needs no database, account service, Redis instance, or additional paid resources.

## Local development

Use Node >=22.18 <23 and pnpm 11.3.0:

```sh
nvm use
pnpm install --frozen-lockfile
pnpm build:server
pnpm start:server
# Separate terminal:
VITE_COLYSEUS_URL=http://127.0.0.1:2567 pnpm dev
```

`pnpm build` produces the Vercel browser application in `dist/`. `pnpm build:server` produces `dist-server/index.mjs` with runtime dependencies external. Shared/server typechecking has no DOM library. The server bundles the same authored Outpost JSON as the client and never fetches gameplay assets from Vercel. A shared compatibility ID covers protocol/gameplay revision, tuning and map content; change the gameplay revision for behavior changes.

## Hosting settings

Colyseus application 1879:

- Runtime: Node 22; build preflight rejects versions below 22.18.
- Repository: ayushrameja/burnhop. Root: `/`.
- Install: `npx --yes pnpm@11.3.0 install --frozen-lockfile`.
- Build: `npx --yes pnpm@11.3.0 build:server`.
- Process file: root `ecosystem.config.js`, one `fork`, `wait_ready: true`.
- Pinned `@colyseus/tools` handles Cloud's `/run/colyseus/2567.sock` listener and public WebSocket process path. HTTP admission guards install before the helper sends its single PM2 readiness notification. Local development retains TCP `PORT` and emits readiness itself.
- `NODE_ENV=production`. The production game origin is allowed exactly for HTTP matchmaking and WebSocket upgrades.
- Optional `ALLOWED_PREVIEW_ORIGINS`: comma-separated exact HTTPS origins. Never use a wildcard for Vercel previews. Localhost is permitted only outside production.

Vercel keeps the existing project/domain and Git production branch:

- Node 22.x; package engines require >=22.18.
- Install: `pnpm install --frozen-lockfile`.
- Build: `pnpm build`; output: `dist`.
- Public production environment: `VITE_COLYSEUS_URL=https://de-fra-24270fd2.colyseus.cloud`.
- Missing endpoint configuration disables online admission while leaving practice usable.

Deployment tokens and credentials belong in provider settings or ignored local files. Do not commit `.env*` or `.colyseus-cloud.json`. Repository visibility is outside this release.

Deploy the backend first on the implementation branch, verify `/health` returns the matching compatibility ID, and run the load gate before updating Vercel production. The GitHub connection requires the repository owner's authorization. PM2 7.0.4 locally verified the ESM named `apps` export, single fork and readiness on Node 22.18; also verify the actual Cloud runtime logs.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm build:server
pnpm test:e2e
pnpm test:online
# After deployment, run only the player flow against the actual game origin:
BURNHOP_SMOKE_URL=https://burnhop.lowhp.studio pnpm test:online
pnpm build:loadtest
node dist-tools/loadtest.mjs --endpoint https://de-fra-24270fd2.colyseus.cloud --seconds 900 --output load-results/frankfurt-15min.json
```

The load harness uses eight actual Colyseus clients, shared prediction, movement, aim, jet, fire and reload inputs. It runs ready/start/rematch cycles until all eight accumulate at least 900 seconds in active gameplay. Each client must produce confirmed shots. It measures `/metrics` and fails on sustained backlog, rolling p99 work >=16.7 ms, memory >=750,000,000 bytes, dropped clients or errors. Short smoke runs explicitly cannot satisfy the fifteen-minute gate. Memory stability needs multiple samples from the latter half of the full run.

For real TCP loss in an isolated Linux network namespace:

```sh
docker build -f scripts/network.Dockerfile -t burnhop-network-test:local .
mkdir -p load-results/linux-network
docker run --rm --network none --cap-add NET_ADMIN \
  -v "$PWD/load-results/linux-network:/results" burnhop-network-test:local
```

This shapes only the disposable container's loopback queue: nominal 150 ms RTT, jitter, 1% TCP packet loss, and a one-second full connection stall. Browser WebSocket relay tests cover delayed input/state and automatic reconnection separately; HTTP throttling is not a substitute for TCP loss.

## Evidence and remaining release gates

- September 5, 2026: all 330 unit/shared/backend tests passed, as did client/server typechecks and both production builds on Node 22.18.
- 89 Chromium regression checks passed, including the new lazy multiplayer/fullscreen-entry race. One existing native OS pointer-capture test is opt-in and was skipped in this headless environment.
- Both local online suites passed: invitation, distinct appearance, ready/countdown cancellation/start, locked joins, capture loss, page-refresh token rotation, host departure, 150 ms RTT/jitter, a one-second bidirectional stall, a 3.2-second acknowledgement stall, and automatic same-session reconnection.
- The built Cloud entrypoint passed a separate Unix socket/proxy test with two actual SDK clients, matching compatibility, origin guards, Cloud WebSocket routing and exactly one readiness signal.
- A separate production-build probe with an empty backend URL showed the unavailable state, disabled online admission, working practice movement/fire/pause, no page errors and no matchmaking requests.
- Linux TCP impairment passed for 90.38 active seconds with eight clients, 3,860 confirmed shots, no disconnects/errors, 1,517 actual dropped packets and a timestamped one-second stall. Maximum rolling p99 was 2.656 ms and peak RSS was 97,488,896 bytes. Every bot moved in 73.5–89.8% of alive state samples, above the unchanged 40% minimum. This short run does not establish long-run memory stability. Evidence is in ignored `load-results/linux-network-2026-09-05-recovery/`.
- The actual Frankfurt release at `7b25e1c` passed every capacity gate: 900.264 active seconds (921.039 wall-clock seconds), eight clients, four match starts, 40,187 confirmed shots and zero disconnects/errors. Maximum rolling p99 was 7.969 ms, peak RSS 114,495,488 bytes (109.19 MiB), longest sustained schedule deficit zero, and dropped simulation time zero. The final memory trend was -1.301 MiB/min across 61 samples. All eight bots moved in 76.4–80.4% of alive state samples. Full evidence: ignored `load-results/frankfurt-15min.json`.
- Actual Cloud logs confirmed fork startup, the guarded Unix socket and old-worker shutdown after its rolling deployment. The provider's post-deploy helper logged a non-fatal `updateProcessConfig` PM2-extension error; the application stayed healthy and passed the full load gate. This is a managed-host maintenance note, not a gameplay test failure.
- The real Canada–India human playtest is deferred at the owner's request. Do not describe the release as validated for that real connection until both players complete it.

Host controls follow the longest-connected remaining pilot. Explicit Leave releases a slot immediately; disconnect reserves it for 30 seconds. Disconnected actors remain vulnerable and stay dead until reconnecting. Match state is temporary and is lost on process restart. Schedule maintenance between matches.
