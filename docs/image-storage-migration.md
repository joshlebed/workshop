# Image storage migration: uploaded images out of Postgres

Status: **awaiting operator sign-off** (2026-11-19). Delete this file in the PR that drops
the legacy columns (step 6).

## Why

Neon's free plan allows 5 GB of network transfer a month; the project was at 4.25 GB on
day 18 of November 2026. Measured from the request log and the database:

| Source                                                 | Transfer in 18 days | How it was measured                                |
| ------------------------------------------------------ | ------------------- | -------------------------------------------------- |
| `GET /v1/users/:id/avatar` reading base64 pictures     | ~1.75 GB            | 8,234 successful hits × each user's stored picture |
| Niteshift sandboxes dumping prod on start              | ~0.75–1 GB          | 89 tasks × ~8.3 MB per dump (estimate)             |
| Everything else (incl. full `users` row reads on auth) | ~1.5 GB             | By subtraction                                     |

Profile pictures were base64 `data:` URLs in `users.avatar_url` (21 rows, avg 185 KB, 3.8 MB
total — half of the whole database). `lists.cover_photo_url` accepts the same thing and is
returned on every `GET /v1/lists` row; no list has one yet, so it is a loaded gun rather than
a current cost. A scan of every text / jsonb column found no other inline image
(`games.icon_url`, `spotify_albums.image_url` and link previews hold external URLs).

## Design

- **No environment keeps images in Postgres.** `apps/backend/src/lib/imageStorage.ts` has two
  drivers: `s3` (prod, `IMAGE_BUCKET`) and `fs` (a local directory: dev, tests, sandbox). A
  deployed stage without a bucket refuses uploads (503) instead of improvising.
- **Keys are content-addressed**: `<kind>/<owner id>/<sha256[:16]>.<ext>`, kinds `avatars` and
  `list-covers`. Rows keep the key (`users.avatar_key`, `lists.cover_photo_key`).
- **`GET /v1/images/<key>`** serves an object, `immutable`, with no database query. Public,
  like the pictures were inline; the 64-bit hash is the capability.
- **Clients do not change.** They upload a `data:` URL in `avatarUrl` / `coverPhotoUrl` and get
  an `https` image URL back in the same field. `GET /v1/users/:id/avatar` stays (ETag / 304).
- **The bucket is private** (Lambda role only), versioned with 14-day noncurrent expiry (the
  undo for a bad delete), and `prevent_destroy`. No CDN: images go out through the API, which
  is free at this size and keeps one access path.
- **Legacy rows keep working** until moved: a row with an inline picture and no key is served
  exactly as before.

## Rollout — in this order

Each step is safe to stop after. Steps 1–4 are PRs; 5 is a hand-run operation; 6 is a PR that
must not merge before 5 is verified.

| #   | Step                                   | PR                                  | What changes in prod                                                         | Undo                                                                            |
| --- | -------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Client caching                         | #607                                | Avatar route sends ETag / 304 / `immutable`. Biggest transfer cut.           | Revert the PR                                                                   |
| 2   | Infra                                  | `image-storage-infra`               | Two empty buckets, a Lambda policy, `IMAGE_BUCKET` env. No behaviour change. | Revert (buckets are empty)                                                      |
| 3   | Backend                                | #608                                | New uploads go to S3. Existing pictures still served from rows.              | Revert; uploads made meanwhile stay readable only after re-apply — see Rollback |
| 4   | Dev environment                        | `sandbox-image-sync`                | Nothing in prod. Sandboxes reuse a cached dump and sync images.              | Revert                                                                          |
| 5   | Backfill (operator / agent on request) | —                                   | 21 pictures copied to S3, verified, inline copies cleared.                   | Restore from the Neon branch taken first                                        |
| 6   | Drop legacy columns                    | `drop-inline-image-columns` (draft) | `avatar_url`, `cover_photo_url` and the legacy code removed.                 | Neon branch                                                                     |

### Step 2 checks (after merge)

```bash
gh run list --workflow=terraform.yml --branch=main --limit=1          # apply green
ACCT=$(aws sts get-caller-identity --query Account --output text)
aws s3api get-bucket-versioning --bucket workshop-prod-images-$ACCT    # Status: Enabled
aws s3api get-public-access-block --bucket workshop-prod-images-$ACCT  # all four true
aws lambda get-function-configuration --function-name workshop-prod-api \
  --query 'Environment.Variables.IMAGE_BUCKET'
```

### Step 3 checks (after merge)

Upload a profile picture in HighScore or Workshop, then:

```bash
aws s3 ls s3://workshop-prod-images-$ACCT/avatars/ --recursive | tail -3   # the new object
./scripts/logs.sh --since 10m --filter "image"                             # no errors
```

### Step 5: the backfill

```bash
# 1. Safety copy of the database as it is (instant, copy-on-write).
neonctl branches create --name pre-image-backfill-$(date +%Y%m%d)

# 2. Dry run: what would move. Expect moved = remaining = 21, unreadable = 0.
aws lambda invoke --function-name workshop-prod-api --cli-binary-format raw-in-base64-out \
  --payload '{"job":"image-backfill","dryRun":true}' /dev/stdout

# 3. Move. Re-run until remaining = 0 (one run handles ~9s of work).
aws lambda invoke --function-name workshop-prod-api --cli-binary-format raw-in-base64-out \
  --payload '{"job":"image-backfill"}' /dev/stdout

# 4. Verify: every keyed row has an object, no inline picture is left.
aws s3 ls s3://workshop-prod-images-$ACCT/avatars/ --recursive | wc -l      # = keyed rows
psql "$PROD" -c "select count(*) filter (where avatar_key is not null) keyed,
  count(*) filter (where avatar_url is not null) inline_left from users"
```

The job clears a row's inline picture only after reading the stored copy back and comparing
bytes, and only if the row still holds the picture it copied. `unreadable > 0` means a row
was left untouched; look at it before step 6.

### Step 6: drop the columns

Only after step 5 shows `inline_left = 0` and a few days of normal use. The migration refuses
to run while any row still holds an inline picture, so merging early fails the deploy's
migrate job instead of deleting data. Keep the Neon branch until this has been in prod for a
week, then delete it.

## Rollback

- **Before step 5** nothing has been removed from the database. Reverting step 3 leaves
  pictures uploaded after it in S3 with rows whose key the old code ignores (they show
  initials until the revert is reverted). Prefer fixing forward.
- **After step 5**: the bucket is versioned, so a deleted or overwritten object can be
  restored for 14 days (`aws s3api list-object-versions`). The inline originals are in the
  `pre-image-backfill-*` Neon branch.
- **Bucket loss** would need the Neon branch; after step 6 and the branch's deletion the
  bucket is the only copy, like any object store. Versioning + `prevent_destroy` are the
  guards.

## Dev environment

- **Local dev and tests**: the `fs` driver writes under `apps/backend/.data/images`
  (gitignored; a temp dir per test process). Nothing to configure.
- **Niteshift sandbox**: `.niteshift/files/db.sh` now (a) reuses a prod dump cached in
  `s3://workshop-prod-dev-snapshots-<account>/prod.dump` when one is under 24h old, so ~1 dump
  a day reaches Neon instead of one per task; (b) leaves `rate_limits` rows out of the dump;
  (c) syncs the image bucket into the local image directory so the prod copy's rows have
  their pictures. `SNAPSHOT_FRESH=1 .niteshift/files/snapshot-prod.sh` forces a new dump.
- The web dev servers' `/api` proxy tells the backend the browser's origin
  (`X-Workshop-Public-Base`, honoured only when `STAGE=local`), so image URLs work in the
  Niteshift preview.

Expected Neon transfer from sandboxes afterwards: ≤30 dumps × ~3.5 MB ≈ 0.1 GB a month, down
from ~0.75–1 GB.

## Decisions for sign-off

1. **S3, private, served through the API** (no CloudFront, no R2). Simplest thing that fits:
   the API already runs in AWS, and 4 MB of pictures does not need a CDN.
2. **14 days of object versions**, which is also how long a deleted account's picture remains
   recoverable.
3. **The cached dump is real user data in a second private bucket**, expiring after 7 days.
   Same exposure as the sandboxes themselves.
4. **Who runs step 5.** It rewrites 21 prod rows; an agent runs it only when asked.
