import { defineConfig, devices } from '@playwright/test';

// Point the player-flow smoke at a deployed site without starting local services.
// Network fault injection relies on development diagnostics and stays local.
const deployedURL = process.env.BURNHOP_SMOKE_URL;
// A developer may already have an unrelated Vite process on the default test port.
const localPort = Number(process.env.BURNHOP_ONLINE_PORT) || 5174;
const localURL = `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: './tests',
  testMatch: deployedURL ? ['multiplayer.spec.ts'] : ['multiplayer.spec.ts', 'multiplayer-network.spec.ts'],
  fullyParallel: false,
  workers: 1,
  outputDir: deployedURL ? 'test-results-production' : 'test-results-online',
  timeout: 60000,
  use: { baseURL: deployedURL || localURL, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: deployedURL ? undefined : [
    { command: 'pnpm build:server && pnpm start:server', url: 'http://127.0.0.1:2567/health', reuseExistingServer: true },
    { command: `pnpm dev --port ${localPort} --strictPort`, url: localURL, reuseExistingServer: true, env: { VITE_COLYSEUS_URL: 'http://127.0.0.1:2567' } },
  ],
});
