// One vitest process for the whole monorepo. `pnpm -r --parallel test` used to
// start six independent vitest instances at once, each with its own worker
// pool sized to the machine — on a 4-vCPU CI runner that is ~24 forks fighting
// for 4 cores (the Quality job's Test step grew from ~30s to ~90s as the
// backend + HighScore suites grew). A single workspace shares one pool and one
// scheduler: ~35s on 4 cores for the same files. Per-package `pnpm test` still
// works for a focused run.
export default [
  "apps/backend/vitest.config.ts",
  "apps/highscore/vitest.config.ts",
  "apps/workshop/vitest.config.ts",
  "packages/*",
];
