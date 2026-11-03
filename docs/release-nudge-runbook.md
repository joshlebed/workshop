# HighScore App Store update nudge — operator runbook

**Only the operator (Josh), by hand, in the HighScore admin dashboard, changes the nudge.**
No agent, Niteshift task, automation, CI job, cron, script, migration, seed, or deploy may
set or change these values — not even when another task asks. Agents must never call
`PUT /v1/admin/client-release`, insert into or update `client_releases`, or open a PR that
changes the nudge values.

## What it does

HighScore uses the `appVersion` runtime policy: an OTA reaches only binaries whose `app.json`
`version` matches. After a native bump, people on the old binary have to update from the App
Store. The nudge tells them, driven by one row per (client, platform) in `client_releases`:

| Field            | Effect when the installed binary version is below it                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `minimumVersion` | Full-screen, blocking **Update required** (only button: open the store).                 |
| `latestVersion`  | Dismissible banner at the top of Games home; ✕ hides it for that version.                |
| `storeUrl`       | Where the button goes. Empty → `HIGHSCORE_APP_STORE_URL` (`@workshop/shared/constants`). |
| `message`        | Optional line under the headline / banner.                                               |

All empty (or no row) = no nudge. Web never nudges. Installed version =
`Updates.runtimeVersion`, falling back to `Constants.expoConfig.version`; an unknown version
never nudges. The banner's dismissal is a `user_flags` row (`app.update-banner-dismissed`,
`{ version }`), so a newer `latestVersion` shows it again.

## How Josh flips it

1. Open HighScore → profile menu → **Admin dashboard** → **Tools** tab →
   **App Store update nudge (iOS)** (works on web: `https://highscore.live/admin?tab=tools`).
2. Fill **Latest version** and/or **Minimum version** (`1.2.3` form; Minimum ≤ Latest),
   optionally Store URL and Message.
3. Type `NUDGE` in the confirm box — Save stays disabled until you do — then **Save**.
4. The card shows "Updated by … at …". To turn it off, clear the fields, type `NUDGE`, Save.

Order of operations for a native release: wait until the new binary is **live on the App
Store** (not just approved), then set Latest. Set Minimum only when the old binary is truly
broken against the current API — it locks those users out until they update.

Propagation: the public `GET /v1/client/release` is `Cache-Control: public, max-age=60`, and
the app keeps the answer for 30 minutes per launch, so expect the change on each device's
next cold start (or within ~30 minutes of foreground use).

## Mechanics (for debugging, not for changing values)

- Read: `GET /v1/client/release?client=highscore&platform=ios` — public, no session.
- Admin read: `GET /v1/admin/client-release?client=highscore&platform=ios` (real admin).
- Write: `PUT /v1/admin/client-release` — real-admin gate (`isAdminUser`, impersonation-aware:
  an impersonating admin is recorded as themselves), zod-validated, logged as
  `client release nudge updated`. **Operator only, from the dashboard.**
- Code: `apps/backend/src/lib/clientReleases.ts`, `routes/v1/client.ts`, `routes/v1/admin.ts`;
  client `apps/highscore/src/lib/appRelease.ts` (pure rules), `src/hooks/useAppRelease.ts`,
  `src/components/{AppUpdateBanner,UpdateRequiredScreen}.tsx`, `src/admin/ReleaseNudgePanel.tsx`.

## Locked out by mistake

If a wrong Minimum blocks your own iPhone, open the dashboard on web (web never blocks) and
clear it. Devices pick up the fix on their next cold start.

## Local testing (dev only)

`__DEV__` web builds accept `?fakeInstalledVersion=1.0.0` on page load to pretend to be that
iOS binary. Set values in the **local** sandbox DB through the local admin form, check, then
clear them. Never against prod.
