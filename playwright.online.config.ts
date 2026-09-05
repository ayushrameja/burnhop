import { defineConfig, devices } from '@playwright/test';

// Point the player-flow smoke at a deployed site without starting local services.
// Network fault injection relies on development diagnostics and stays local.
const deployedURL = process.env.BURNHOP_SMOKE_URL;

export default defineConfig({
  testDir: './tests',
  testMatch: deployedURL ? ['multiplayer.spec.ts'] : ['multiplayer.spec.ts', 'multiplayer-network.spec.ts'],
  fullyParallel: false,
  workers: 1,
  outputDir: deployedURL ? 'test-results-production' : 'test-results-online',
  timeout: 60000,
  use: { baseURL: deployedURL || 'http://127.0.0.1:5174', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: deployedURL ? undefined : [
    { command: 'pnpm build:server && pnpm start:server', url: 'http://127.0.0.1:2567/health', reuseExistingServer: true },
    { command: 'pnpm dev --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: true, env: { VITE_COLYSEUS_URL: 'http://127.0.0.1:2567' } },
  ],
});
