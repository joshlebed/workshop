import { defineConfig } from "vitest/config";

// One vitest process for the whole monorepo. `pnpm -r --parallel test` used to
// start six independent vitest instances at once, each with its own worker
// pool sized to the machine — on a 4-vCPU CI runner that is ~24 forks fighting
// for 4 cores (the Quality job's Test step grew from ~30s to ~90s as the
// backend + HighScore suites grew). A single root config with `projects`
// shares one pool and one scheduler. Per-package `pnpm test` still works for
// a focused run. CI shards this with `--shard=N/2` (see .github/workflows/ci.yml).
export default defineConfig({
  test: {
    projects: [
      "apps/backend/vitest.config.ts",
      "apps/highscore/vitest.config.ts",
      "apps/workshop/vitest.config.ts",
      "packages/*",
    ],
  },
});
