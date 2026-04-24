import { defineConfig, devices } from "@playwright/test";

// Happy-path E2E runner for the Workshop.dev web client.
//
// Expected pre-conditions when this runs:
//   • Backend on http://localhost:8787 with `DEV_AUTH_ENABLED=1`
//   • Web bundle on http://localhost:8081 with `EXPO_PUBLIC_DEV_AUTH=1`
//
// The `pnpm run e2e` script in package.json starts both with the right
// env vars before invoking Playwright. CI integration lands in Phase 5
// (see docs/redesign-plan.md §3 Phase 5).

const WEB_PORT = Number(process.env.WORKSHOP_E2E_WEB_PORT ?? 8081);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
