import { defineConfig } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run seed && npm run start',
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      DATABASE_FILE: 'data/e2e.db',
    },
  },
});
