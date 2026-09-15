# Moderation runbook (App Store Review Guideline 1.2)

HighScore ships user-generated content — display names, profile photos and pasted
score text — so Apple requires: an EULA with zero tolerance for objectionable
content, a content filter, a report mechanism, a block mechanism, and the developer
**acting on reports within 24 hours** by removing the content and ejecting the user.
This page is the operator half of that promise.

## What the app already does on its own

| Precaution                    | Where                                                                                                                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EULA presented before sign-in | `apps/highscore/app/sign-in.tsx` links `/terms` + `/privacy`; copy in `src/lib/legal.ts`                                                                                                                                                                                                     |
| Filter                        | `apps/backend/src/lib/contentFilter.ts` — rejects slurs in display names (`PATCH /v1/users/me`) and score pastes (`PUT /v1/games/:id/scores`) with 400 `OBJECTIONABLE_CONTENT`                                                                                                               |
| Report                        | Profile page **Report** (name/photo) and **Report this score…** in the reaction picker → `POST /v1/reports` → `content_reports` row + `#workshop-admin` ping                                                                                                                                 |
| Block                         | Profile page **Block** → `POST /v1/users/:id/block` → drops the friendship + pending requests (scores are friends-only, so the pair vanish from each other's boards on the next fetch), refuses every re-friend path, pings `#workshop-admin`. Unblock lives in Edit profile → Blocked users |

## The 24-hour loop

1. **A report lands.** Discord `#workshop-admin` gets
   `:rotating_light: content report — <reporter> reported <target> (<kind>, <reason>) — "<snapshot>" · target id <uuid>`.
   The snapshot is the name or pasted text at report time, so you can judge it even if
   the author has since edited it.
2. **Look, if needed.**
   ```bash
   AWS_PROFILE=workshop-prod ./scripts/db-connect.sh
   select created_at, content_kind, reason, details, content_snapshot, resolved_at
     from content_reports where target_user_id = '<uuid>' order by created_at desc;
   ```
3. **Decide.**
   - Objectionable → eject (step 4). Deleting the account removes the content and the
     user in one step; that is Apple's required outcome.
   - Not objectionable → mark resolved so the queue stays honest:
     ```sql
     update content_reports set resolved_at = now()
       where target_user_id = '<uuid>' and resolved_at is null;
     ```
4. **Eject.** Uses the same transaction as in-app account deletion
   (`lib/accountDeletion.ts`), marks their open reports resolved first so the audit
   trail survives the cascade, and revokes provider tokens.
   ```bash
   AWS_PROFILE=workshop-prod DATABASE_URL=$(./scripts/db-url.sh) \
     pnpm --filter @workshop/backend run admin:eject -- --user-id=<uuid> --dry   # preview
   AWS_PROFILE=workshop-prod DATABASE_URL=$(./scripts/db-url.sh) \
     pnpm --filter @workshop/backend run admin:eject -- --user-id=<uuid>         # do it
   ```
   Note: HighScore and Workshop.dev share one `users` row — ejecting removes both.
5. **Reply to the reporter** only if they emailed; in-app reports are anonymous to the
   target and don't need a reply.

Do all of this inside 24 hours of the Discord ping. If you'll be away longer than that,
hand the webhook + `admin:eject` access to someone who won't be.

## Filter tuning

`BLOCKED_TERMS` in `contentFilter.ts` is deliberately short: slurs and "kill yourself"
only, whole-word after leet/separator normalisation. Score pastes are random letter
runs, so a broad profanity list produces false rejections. Add a term only with a test
in `contentFilter.test.ts` proving a plausible score paste still passes.
