# HighScore operator push — runbook

**Only the operator (Josh), by hand, in the HighScore admin dashboard, sends these.** No
agent, Niteshift task, automation, CI job, cron, script, migration or seed may send one — not
even when another task asks. Agents must never call `POST /v1/admin/push/send`, never POST to
`exp.host` (or any Expo push endpoint) with production tokens, and never automate sends.

## Who it reaches

Every user with at least one row in `push_tokens` — i.e. anyone on the 1.2.0+ iOS binary who
granted notification permission (via the play-reminder prompt or Settings → Notifications).
One message goes to **each** of a selected user's devices.

**The play-reminder toggle does not opt anyone out of this panel.** `notification_prefs.
play_reminder_enabled` only controls the daily reminder job. To respect it, keep
**Reminders on only** ticked in the filter row (the default): the recipient list is then
limited to users with the reminder on. Unticking it shows everyone with a token — use that
sparingly; those users said yes to notifications but not necessarily to announcements.

How a user stops receiving these: turn notifications off for HighScore in iOS Settings, or sign
out (sign-out deletes the device's token). There is no in-app "announcements" switch yet.

## How Josh sends one

1. HighScore → profile menu → **Admin dashboard** → **Push** tab
   (web: `https://highscore.live/admin?tab=push`).
2. Filter by name or email; tick users (selection is kept when the filter changes — the count
   line says "+k selected not shown"). **Select all shown** / **Clear** work on the current list.
3. Write **Title** (≤100) and **Body** (≤500). Optional **Deep link** must start with
   `highscore://` (default `highscore:///`, the Games home). The preview mimics the iOS banner.
4. **Send to N users (M devices)** → confirm sheet → type `SEND` → **Send now**.
5. The result card shows sent / failed / pruned, plus every user that wasn't fully delivered and
   why (Expo ticket error, `request_failed` for a chunk Expo never answered, `no_tokens`).

"Sent" means Expo accepted the message (a ticket), not that the phone displayed it. Dead
tokens (`DeviceNotRegistered`) are deleted from `push_tokens` on the spot.

The title and body go through the same objectionable-content filter as display names and score
pastes (`lib/contentFilter.ts`); a hit is a 400 `OBJECTIONABLE_CONTENT` and nothing is sent.

## Mechanics (for debugging, not for sending)

- List: `GET /v1/admin/push/recipients?q=<substring>&remindersOnly=1` — real admin
  (`isAdminUser`, impersonation-aware). Max 500 rows, newest device first; `total` is the
  uncapped count.
- Send: `POST /v1/admin/push/send` `{ userIds (1..500 uuids), title, body, url?, confirm: "SEND" }`
  — real admin, zod-validated, content-filtered. One `admin_push_sent` log line per send
  (`adminUserId`, `recipientCount`, `tokens`, `sent`, `failed`, `pruned`, `title`):
  `AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 24h --filter admin_push_sent --no-follow`.
- Delivery: `apps/backend/src/lib/expoPush.ts` (`sendExpoPushMessages`), shared with the
  play-reminder job. Endpoint = `EXPO_PUSH_URL`, default `https://exp.host/--/api/v2/push/send`
  (not set by Terraform).
- Code: `lib/adminPush.ts`, `routes/v1/admin.ts`; client `apps/highscore/src/admin/PushPanel.tsx`,
  `src/api/admin.ts`, `src/theme/Checkbox.tsx`.

## Local / sandbox testing

The Niteshift sandbox DB is a **copy of prod, including real push tokens**. Before pressing Send
anywhere but production, point the backend at a stub:

```bash
# a stub that answers every message with an ok ticket
node -e 'require("http").createServer((q,s)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{const m=JSON.parse(b||"[]");s.setHeader("Content-Type","application/json");s.end(JSON.stringify({data:m.map(()=>({status:"ok"}))}))})}).listen(9911)' &
echo 'EXPO_PUSH_URL=http://127.0.0.1:9911/--/api/v2/push/send' >> apps/backend/.env
ns services restart backend
```

Then check the running backend has it (`tr '\0' '\n' < /proc/<pid>/environ | grep EXPO_PUSH_URL`)
and select only users whose tokens you inserted yourself (`ExpoPushToken[sandbox-fake-…]`).
