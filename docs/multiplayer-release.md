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
- Install: `pnpm install --frozen-lockfile` with pnpm 11.3.0.
- Build: `pnpm build:server`.
- Process file: root `ecosystem.config.js`, one `fork`, `wait_ready: true`.
- App sends `process.send('ready')` only after HTTP/WebSocket listening starts.
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

- Shared/practice unit suites and server integration tests are executable in the repository.
- Two isolated browser sessions passed invitation, distinct appearance, ready/countdown cancellation/start, locked joins, capture loss, page-refresh recovery and host departure checks locally.
- Initial local eight-client 60-second smoke: 2,789 confirmed shots, no disconnects/errors, max rolling p99 3.60 ms, peak RSS 85.77 MiB, no sustained backlog. This is **not** a Frankfurt capacity result.
- Actual Frankfurt fifteen-minute capacity validation and the real Canada–India playtest must be recorded before describing the release as validated for that connection.

Host controls follow the longest-connected remaining pilot. Explicit Leave releases a slot immediately; disconnect reserves it for 30 seconds. Disconnected actors remain vulnerable and stay dead until reconnecting. Match state is temporary and is lost on process restart. Schedule maintenance between matches.
