FROM node:22.18.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/* && npm install --global pnpm@11.3.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.server.json tsconfig.tools.json vite.server.config.ts vite.loadtest.config.ts ./
COPY src ./src
COPY public/assets/outpost.json public/assets/arena.json ./public/assets/
COPY scripts/check-node.mjs scripts/loadtest.ts scripts/network-test.sh ./scripts/
RUN pnpm build:server && pnpm build:loadtest
CMD ["bash", "scripts/network-test.sh"]
