# Catalog ops runbook

The HighScore **catalog** (Add a game → untick "Friends only") is the one place a user-added game reaches
people outside the adder's friend graph. It shows the **official catalog** only: catalog registry
games plus the operator-reviewed `OFFICIAL_CATALOG_EXTRAS` in
`packages/shared/src/gameRegistry.ts`. Nothing reaches it without a human merge — that is the
content gate (App Review Guideline 1.2 applies here just like it does to scores and names).

**Rule: a catalog game always has a parser and a formatter** (operator decision, 2026-11-03).
A stranger who adds a game from the catalog should see their first paste read and rendered,
not stored unread as raw text. An extra that isn't taught yet stays out — or comes out — until
someone teaches it (a teach writes both). The audit enforces this on its side: it only proposes
candidates with both, and reports any listed extra missing either as "not catalog-ready".
A registry game missing one is a code fix (below), not a removal.

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
     (`objectionable-title`, `tagline-title`, `no-parser`, `no-formatter`, `single-player`).
     Only candidates with neither `objectionable-title` nor a missing parser/formatter are
     in the proposed-extras block; the rest are listed as "Not ready". `tagline-title`
     means the stored title reads like a page tagline ("Krillion · the daily dive") and comes
     with the cleaned name; a listed game with such a title is reported under health too.
   - **Listed games needing attention** — no parser, no formatter, open parse conflict, or
     > 20% of the last 30 days' scores unread.
   - **Stale extras** — listed URLs with no `games` row (prune).

3. Opens **one PR** (branch `ops/catalog-audit-YYYY-MM-DD`, never auto-merged) that adds the
   proposed (catalog-ready, non-flagged) candidates to `OFFICIAL_CATALOG_EXTRAS`, removes any
   listed extra the audit reports as "not catalog-ready", and pastes
   the full report in the description. Anything flagged `objectionable-title` is listed in the
   description for `admin:eject` review and **never** added. If there are no candidates and no
   health changes since the last run, it opens nothing and just posts its summary.

4. For the health section it reports and recommends; it does not change parse or format code.
   A missing formatter on a **registry** game is fixed in
   `apps/backend/src/lib/gameCode/builtin.ts` and installed on the existing prod row with
   `admin:game-code` — `games.format_code` is seeded from `builtin.ts` only when the row is
   created, so a registry `formatShareBody` change alone never clears the flag. A bad unread
   rate on an **extra** is usually "nobody taught it yet": leave it, note it. Code changes need
   a labelled example set (see `apps/backend/CLAUDE.md`, game code). The exception is the
   catalog rule above: an **extra** with no parser or no formatter is removed from
   `OFFICIAL_CATALOG_EXTRAS` in the audit PR (it comes back through a later audit once taught).

## What the operator does

Review the PR like any content decision:

- **Is it a real game people should see?** Open the URL. Drop junk, duplicates, anything
  offensive. The title ships as-is from the `games` row. New rows get `cleanGameTitle`
  (`lib/gameCatalog.ts`: head before the first separator, `og:site_name` when the title is
  still a sentence — backtested 2026-11-02 against every prod game, 13 fixed, 0 regressed);
  it is a heuristic, so the audit flags what slips through (`tagline-title`) and a bad one is
  a hand `UPDATE games SET title = '…' WHERE normalized_url = '…'` in Neon.
- **Is the category right?** The audit's suggestion is a regex over title + URL; the automation
  then visits the page and picks the category it believes is right, noting where it overrode
  the suggestion. You have the final say — change it in the PR.
- **Merge.** Merge = deploy (Lambda via Terraform apply, OTA ~60s), and the game appears in the
  catalog under its type. There is no DB write.

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
- A candidate with no parser or no formatter is never in the proposed extras block.
