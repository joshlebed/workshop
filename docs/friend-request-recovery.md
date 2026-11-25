# Pending friend-request recovery (onboarding spike #7)

**Question:** how many stale directed friend requests complete once the recipient is actually told?
Prod on 2026-11-25: 58 directed requests pending, 52 older than 7 days, against 178 friendships.
The sandbox copy that day had 55 pending; **only one of their recipients (2 requests) had a push
token**, so the in-app surfaces carry most of this, not the push.

## State machine (one directed `friend_requests` row, `invitee_id` set)

```
                  send (POST /v1/friends/requests)
                              │  expires_at = now + 14d
                              ▼
   ┌──────────────────────  pending  ──────────────────────┐
   │ accept / cross-request /  │ 48h old, reminded_at NULL, │ deny (recipient), cancel
   │ invite-link accept /      │ recipient has a push token,│ (sender), block
   │ play-link vouch           │ 09:00–20:59 recipient-local│
   ▼                           ▼                            ▼
 row deleted,          pending + reminded_at        row deleted
 friendship formed     (push sent once)
 event: accepted |            │
 accepted_after_reminder      │ expires_at passes (job)
                              ▼
                           expired  (status = 'expired', responded_at = now)
                              │  gone from the recipient's inbox, badge, card
                              │  sender's profile view: "Request expired — send again"
                              ▼
               sender re-sends → expired row deleted (event: resent) → new pending row
```

- "Live pending" = `status = 'pending' AND (expires_at IS NULL OR expires_at > now())`
  (`livePendingWhere` in `apps/backend/src/lib/friendRequestLifecycle.ts`). Every read uses it, so
  a row past `expires_at` the job hasn't swept yet already reads as gone.
- The partial unique index (`status = 'pending'`) still allows one pending row per pair; an
  expired row doesn't block a new one, and the re-send deletes it anyway.
- An expired request vouches the **sender** past the profile's anti-probe 404 (as the pending one
  did), so a sender with no mutual friends can still re-send. The recipient gets no such vouch.
- Accept, deny, cancel and block delete pending **and** expired rows between the pair.

## Rollout decision: existing rows are not expired by the migration

Migration `0066_friend_request_recovery` adds `reminded_at` / `expires_at` and the
`friend_request_events` table, and sets `expires_at = now() + 14 days` on every row pending at
migration time. So:

1. The first job run after deploy sends the 48h reminder once to every recipient (with a push
   token, in their daytime) of the ~52 stale requests.
2. Those rows expire 14 days **after deploy**, not 14 days after they were sent. Nothing expires
   at deploy.
3. New requests expire 14 days after they're sent.

## The job

`apps/backend/src/jobs/friendRequestReminders.ts`, `runFriendRequestReminderJob`. It rides the
six-hourly `request-rollups` invocation (00:01, 06:01, 12:01, 18:01 UTC), which already wakes the
database (Neon compute rule in the root CLAUDE.md), under its own `runJob("friend-request-reminders")`
so a failure alarms by name and never stops the rollup. `{ "job": "friend-request-reminders" }`
runs it on demand. Each run:

1. **Expire** pending rows past `expires_at` (silent; no push).
2. **Remind** pending rows ≥48h old with no `reminded_at`, grouped per recipient, only while it is
   09:00–20:59 in the recipient's canonical timezone (latest push token). Six-hour ticks give
   every timezone at least two windows a day, so a reminder lands within ~6–18h of the 48h mark.
   A row is marked `reminded_at` only when Expo answered for at least one of the recipient's
   devices. Recipients with no push token are never pushed and stay un-reminded.

## Push payloads

| Push                                                | title                  | body                                                                                        | `data`                                                                                      |
| --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Fresh request (`lib/friendRequestPush.ts`, at send) | New friend request     | `Sam wants to be friends on HighScore`                                                      | `{ kind: "friend_request", userId: <sender>, url: "highscore:///friends" }`                 |
| 48h reminder (job)                                  | Friend request waiting | `Sam wants to be friends on HighScore` / `Sam and 2 others want to be friends on HighScore` | `{ kind: "friend_request_reminder", userId: <newest sender>, url: "highscore:///friends" }` |

HighScore routes a tap through `notificationPath(data.url)` → `/friends`. The fresh-request push
had no `url` before this change, so a tap opened the home.

## Surfaces (HighScore)

- **Home header Friends button** — badge with the live inbound count (it is the Friends entry;
  HighScore has no visible tab bar).
- **Friends screen** — inbound requests pinned at the top, above "Add a friend", with Accept /
  Decline inline.
- **Home card** — "Sam wants to be friends" for the newest live inbound request, with Accept,
  Decline, "See all" (when more than one) and an X. The X only hides the card for that request
  (`friends.request-card` user flag: `{ userId, requestedAt, dismissedAt }`); it never declines. A
  newer request brings the card back.
- **Profile** — the sender viewing the recipient after expiry sees "Request expired — send again"
  and a **Send again** button.

## Instrumentation

Durable rows in `friend_request_events` (`kind`, `inviter_id`, `invitee_id`,
`request_created_at`, `created_at`) plus a log line each:

| kind                      | when                                              | log `msg`                                           |
| ------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| `reminded`                | the 48h push went out                             | `friend request reminder sent`                      |
| `accepted_after_reminder` | accepted after `reminded_at` was set              | `friend request accepted` (`after_reminder: true`)  |
| `accepted`                | accepted with no reminder (baseline)              | `friend request accepted` (`after_reminder: false`) |
| `declined_after_reminder` | the recipient declined/blocked a reminded request | —                                                   |
| `expired`                 | the job expired it                                | `friend request expired`                            |
| `resent`                  | the sender re-sent after an expiry                | `friend request resent`                             |

Answering the spike question (read-only, prod via `scripts/db-connect.sh`):

```sql
SELECT kind, count(*) FROM friend_request_events
WHERE created_at >= '<deploy date>' GROUP BY kind ORDER BY kind;

-- Requests pending at deploy that were later accepted, and whether a push preceded it.
SELECT kind, count(*) FROM friend_request_events
WHERE kind IN ('accepted', 'accepted_after_reminder')
  AND request_created_at < '<deploy date>' GROUP BY kind;
```
