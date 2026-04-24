# apps/backend

Hono app that runs both as a Lambda handler (`src/lambda.ts`) and as a local Node server
(`src/server.ts`). Shared route definitions live in `src/app.ts`.

## Adding a route

1. Add the handler file under `src/routes/<area>.ts`.
2. Mount it in `src/app.ts` (`app.route("/area", areaRoutes)`).
3. If auth is required, put `app.use("*", requireAuth)` at the top of the sub-router (see
   `watchlist.ts`).
4. If request/response types are shared with mobile, add them to `packages/shared/src/types.ts`.
5. Add a vitest test next to the file if the logic is non-trivial.

## Adding a table

1. Edit `src/db/schema.ts`.
2. `pnpm run db:generate -- --name=describe_change` — always pass `--name`.
3. Review the generated SQL in `drizzle/`.
4. Apply locally: `pnpm run db:migrate`.
5. Commit the SQL file **and** the `drizzle/meta/` snapshot **and** `_journal.json`.

Migrations run automatically in CI on merge to main (`deploy-backend.yml` → `migrate` job).

## Config + secrets

`src/lib/config.ts` validates env vars with zod and fails fast if anything is missing. In prod,
Terraform sets env vars on the Lambda function. In local dev, `scripts/dev.sh` seeds `.env` from
`.env.example` (generating a random `SESSION_SECRET`).

## Lambda specifics

- `src/lambda.ts` is the handler — bundled by `scripts/bundle.mjs` (esbuild) into a single file.
- AWS SDK v3 is marked `external` (provided by the Lambda runtime) to shrink the zip.
- `postgres` (the pg driver) is bundled because there's no built-in.
- Cold start ~300–500ms for a bundled Node.js 20 Hono handler.

## Auth (in flight — see `docs/redesign-plan.md`)

The v1 magic-link flow has been removed. OAuth (Apple + Google) lands in Phase 0b; until then
`/v1/*` returns 501 and there's no working sign-in path. Don't reintroduce SES — `sesFromAddress`
is gone from `lib/config.ts` and `@aws-sdk/client-ses` is no longer a dependency.
