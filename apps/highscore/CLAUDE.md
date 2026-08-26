# apps/highscore — coding agent guide

HighScore owns its complete frontend under `app/` and `src/games/`. Style, layout, branding, and
client behavior should be implemented locally so they cannot change Workshop users. Do not move
presentation code back into a shared package.

Shared boundaries are contracts and primitives only: `@workshop/api-client`, `@workshop/shared`
(`games`, `gameRegistry`, `scoreParsing`, `summarySpec`), and `@workshop/ui`. Workshop's current
Games UI is a frozen snapshot at `apps/workshop/src/legacyGames/`; never update it in lockstep with
HighScore. Only an explicitly requested critical-fix backport may touch both copies.

Friends remain a shared product concept backed by the same graph and `@workshop/api-client/friends`,
but each app owns its screen implementation so either frontend can evolve independently.
