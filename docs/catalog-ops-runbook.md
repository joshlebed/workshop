# Catalog ops runbook

The HighScore **Catalog** tab (Add a game → Catalog) is the one place a user-added game reaches
people outside the adder's friend graph. It shows the **official catalog** only: catalog registry
games plus the operator-reviewed `OFFICIAL_CATALOG_EXTRAS` in
`packages/shared/src/gameRegistry.ts`. Nothing reaches it without a human merge — that is the
content gate (App Review Guideline 1.2 applies here just like it does to scores and names).

## What the daily automation does

A Niteshift automation (**"HighScore catalog audit"**, daily 13:00 UTC, repo `joshlebed/workshop`)
starts a task that:

1. Runs the read-only audit against prod:

   ```bash
   DATABASE_URL="$(aws ssm get-parameter --name /workshop-prod/db/url \
     --with-decryption --query Parameter.Value --output text)" \
     pnpm --filter @workshop/backend run ops:catalog-audit
   ```

   (`apps/backend/scripts/catalog-audit.ts` → `src/lib/catalogAudit.ts`; the session is opened
   `default_transaction_read_only`, so it cannot write. The sandbox role already has
   `ssm:GetParameter` on `/workshop-prod/*`.)

2. Reads the three sections:
   - **Candidates** — games with ≥1 player that aren't listed, each with a suggested game type
     (keyword guess), player + 30-day score counts, parser status, and flags
     (`objectionable-title`, `no-parser`, `single-player`).
   - **Listed games needing attention** — no parser, no formatter, open parse conflict, or
     > 20% of the last 30 days' scores unread.
   - **Stale extras** — listed URLs with no `games` row (prune).

3. Opens **one PR** (branch `ops/catalog-audit-YYYY-MM-DD`, never auto-merged) that adds the
   non-flagged candidates to `OFFICIAL_CATALOG_EXTRAS` with the suggested categories, and pastes
   the full report in the description. Anything flagged `objectionable-title` is listed in the
   description for `admin:eject` review and **never** added. If there are no candidates and no
   health changes since the last run, it opens nothing and just posts its summary.

4. For the health section it reports and recommends; it does not change parse or format code.
   A missing formatter on a **registry** game is fixed in
   `apps/backend/src/lib/gameCode/builtin.ts` and installed on the existing prod row with
   `admin:game-code` — `games.format_code` is seeded from `builtin.ts` only when the row is
   created, so a registry `formatShareBody` change alone never clears the flag. A bad unread
   rate on an **extra** is usually "nobody taught it yet": leave it, note it. Code changes need
   a labelled example set (see `apps/backend/CLAUDE.md`, game code).

## What the operator does

Review the PR like any content decision:

- **Is it a real game people should see?** Open the URL. Drop junk, duplicates, anything
  offensive. The title ships as-is from the `games` row — fix a bad one with
  `admin:game-code`'s neighbour scripts or directly in Neon, then re-run.
- **Is the category right?** The audit's suggestion is a regex over title + URL; the automation
  then visits the page and picks the category it believes is right, noting where it overrode
  the suggestion. You have the final say — change it in the PR.
- **Merge.** Merge = deploy (Lambda via Terraform apply, OTA ~60s), and the game appears in the
  Catalog tab under its type. There is no DB write.

Removing a game from the catalog is deleting its entry and merging. Blocking a _person_ is
`admin:eject` (`docs/moderation-runbook.md`), which also removes their `user_games` rows.

## Running it by hand

```bash
# markdown (what the PR body uses)
DATABASE_URL=… pnpm --filter @workshop/backend run ops:catalog-audit
# machine-readable
DATABASE_URL=… pnpm --filter @workshop/backend run ops:catalog-audit -- --json
```

Against the local sandbox DB: `set -a; . apps/backend/.env; set +a` first.

## Invariants (tested in `catalogAudit.test.ts` + `games.test.ts`)

- Popularity never lists a game: `GET /v1/games/catalog` filters by `isOfficiallyListed` only.
- The catalog response carries a platform-wide `playerCount` and **no user names**.
- A flagged (`objectionable-title`) candidate is excluded from the proposed extras block.
- A detection-only registry game (`catalog: false`, e.g. Heardle) is not listed.
