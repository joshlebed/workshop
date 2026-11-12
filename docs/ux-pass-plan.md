# Workshop — usability pass: audit and engineering plan

Status: approved 2026-11-11, done through Phase 5 (in review) · Opened: 2026-11-11 · Scope: `apps/workshop` + `packages/ui` (HighScore untouched)

The feature set is settled. This document is the audit of how the app feels to use today and the
plan for making it production grade. It follows `PRODUCT.md` and `DESIGN.md`; nothing here changes
the brand or the palette.

Method: a walkthrough of the running app at phone and desktop widths, plus three independent code
audits (core list interactions, every other flow, design-system quality). About 100 findings were
de-duplicated into the work below. The five highest-severity claims were re-checked against the
code by hand. Findings marked _(suspected)_ were read from code and still need a device check.

## 1. Diagnosis

Three root causes explain almost every finding.

1. **The core loop costs too many taps and gives nothing back.** A to-do list has no checkbox
   on its rows. Adding five items is five modal round trips, and Return does nothing. Completing
   and deleting wait on the server, with no undo. Drag fights tap.
2. **There is no shared vocabulary.** The same thing has several names (ranked / ordered,
   done / complete, delete / remove / archive), several looks (five back buttons, four list rows,
   three save models), and several behaviours per platform. `packages/ui` lacks the primitives
   that would make consistency the default, so each screen hand-rolls them.
3. **The edges into the app are broken.** The share-link join path loses the list for a new
   user, a signed-in visitor on `/list/:id` is told joining is disabled when it is not, and
   first run explains nothing.

Nielsen heuristic estimate today: **19/40**. Lowest scores: user control and freedom (no undo, 1),
consistency (1), error prevention (one-tap list delete, 1), visibility of system status (2).
Target after this pass: 32+.

## 2. Interaction rules (the decisions everything else follows)

These are the product-level rules. Each phase below is an application of them.

| Rule                                 | Meaning                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Act, then undo**                   | Reversible actions (complete, delete item, hide list, remove tag, unrank) happen at once and show a toast with Undo. Only irreversible ones (delete list, leave, remove member) ask first, and the dialog names the object. |
| **Every tap answers within a frame** | Every mutation is optimistic with rollback and an error toast. Haptic fires on the tap, not on the response.                                                                                                                |
| **One row**                          | `[check] [cover] title / one quiet line [trailing]`. The whole row opens detail. Same anatomy on home, list, picker, archive, activity.                                                                                     |
| **One header**                       | `ScreenHeader` everywhere. Destinations are pushes with `‹`. Flows that create something are modals with `✕` on the left and the commit action on the right.                                                                |
| **Edits autosave, creates commit**   | Editing an existing thing (item, list details, settings toggles) saves as you go with a "Saved" indicator. Only creating something has an explicit button.                                                                  |
| **One word per thing**               | See the glossary in §6.                                                                                                                                                                                                     |
| **Content before chrome**            | Cached content is never replaced by a spinner or an error. First load is a skeleton of the real layout.                                                                                                                     |
| **Phone first, 44pt, 16px**          | Every target is at least 44pt including on web (where `hitSlop` does nothing). Every input is at least 16px (iOS Safari zoom).                                                                                              |

## 3. Plan

Six phases. 0 is bug fixes and ships first. 1 unblocks 2–5, which can then run in parallel as
separate tasks. Sizes: S under a day, M one to three days, L more.

### Phase 0 — Stop the bleeding (correctness, all S)

Shippable as two or three PRs with no design decisions.

| #    | Fix                                                                                                                                                                                                                                                                                              | Where                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 0.1  | **Confirm before Delete list, Leave list, Remove member, Make owner, Reset link.** All five fire on one tap today.                                                                                                                                                                               | `list/[id]/settings.tsx:909,922,736,737,851`                           |
| 0.2  | **Item detail autosave overwrites what you are typing.** Seed drafts once per item; never reset a dirty or focused field; flush the pending save on back _(suspected loss of last 700ms)_.                                                                                                       | `item/[itemId].tsx:87-93,231`                                          |
| 0.3  | **New user from a share link loses the list.** The stashed `/l/:slug` return path is ignored (only `/list/` is honoured) and never cleared.                                                                                                                                                      | `app/_layout.tsx:228`, `ListPublicLanding.tsx:66`                      |
| 0.4  | **Signed-in non-member on `/list/:id` sees "joining is disabled".** The route never passes `onJoin`.                                                                                                                                                                                             | `list/[id]/index.tsx:104`                                              |
| 0.5  | Join failure is silent (spinner stops, no message).                                                                                                                                                                                                                                              | `app/l/[slug].tsx:105`                                                 |
| 0.6  | Return / Enter submits the add form; URL field gets `keyboardType="url"`.                                                                                                                                                                                                                        | `list/[id]/add.tsx:514-540`                                            |
| 0.7  | Row taps eaten by drag: adopt the shared `REORDER_ACTIVATION` thresholds (500ms / 10px) that HighScore already uses.                                                                                                                                                                             | `ItemRow.tsx:251`, `ItemList.web.tsx:101`                              |
| 0.8  | Rank numbers and "move to top/bottom" are wrong while a filter is active (they use the filtered index).                                                                                                                                                                                          | `ItemList*.tsx`, `ListDetail.tsx:489,497`                              |
| 0.9  | A failed background refetch replaces cached lists with a full-screen error. Gate on `isError && !data`.                                                                                                                                                                                          | home, activity, friends, share picker                                  |
| 0.10 | Inputs under 16px zoom iOS Safari: list search, tag input, item URL, Letterboxd username.                                                                                                                                                                                                        | `ListDetail.tsx:1189`, `TagEditor.tsx:111`, `[itemId].tsx:934`         |
| 0.11 | Item detail opened cold has no "Mark done" (parent list read once from cache, not subscribed).                                                                                                                                                                                                   | `item/[itemId].tsx:75`                                                 |
| 0.12 | Module save has no spinner and swallows errors.                                                                                                                                                                                                                                                  | `settings.tsx:245`                                                     |
| 0.13 | Sheet-then-confirm races the sheet exit on iOS (sign out, delete item) _(suspected)_. Run from `onClosed`.                                                                                                                                                                                       | `ProfileMenu.tsx:99`, `[itemId].tsx:273`, `ItemRowMenu.tsx:44`         |
| 0.14 | Row menu "Delete" is drawn in the amber accent; use `status.danger`. Danger button label fails AA (3.06:1); use `text.onAccent`.                                                                                                                                                                 | `ItemRowMenu.tsx:154`, `Button.tsx:108`                                |
| 0.15 | Light-mode phones get dark status-bar glyphs on a dark app (the app always paints dark tokens). Pin status bar, nav theme and `userInterfaceStyle` to dark until light mode ships.                                                                                                               | `app/_layout.tsx:325`, `app.json`                                      |
| 0.16 | Web shell still paints the retired navy `#081325` (URL bar, overscroll).                                                                                                                                                                                                                         | `public/index.html:52,66`                                              |
| 0.17 | Share picker lists archived lists and sorts differently from home; "Any member" is offered "Delete view" then gets a 403; bell badge is stale after visiting Activity _(suspected)_.                                                                                                             | `share/pick-list.tsx:67`, `SavedViewsBar.tsx:114`, `activity.tsx`      |
| 0.18 | **Remove the Friends surface from Workshop** (decided: multiplayer is per list). Delete `/friends`, `/friends/:id`, `src/friends/*` and the menu entry. `/friends/accept/:token` stays as a hand-off to HighScore, like `/g/:token`. Backend friends routes are untouched (HighScore uses them). | `app/friends/*`, `src/friends/*`, `ProfileMenu.tsx`, `profile.tsx:122` |

**Phase 0 status (2026-11-11): done, all 18 rows**, in the `joshlebed/ux-pass-phase-0` PR
(stacked on this plan). Verified in the running web app at 390×844. Not verifiable on web, so
still owed a device check: 0.13 (iOS Modal/Alert race), 0.15's native status bar, and 0.7's
native long-press. Deviations and extras:

- 0.15 pins dark in JS only (status bar, navigation theme, `ThemeProvider forceScheme`).
  `userInterfaceStyle` in `app.json` stays `automatic`: changing it moves the iOS fingerprint and
  forces a version bump, which would stop Phase 0 reaching 0.7.0 installs over the air. Flip it
  with the next native bump.
- Found and fixed: a new user who had to pick a display name was bounced between home and
  onboarding, and the share-link return path was consumed on the way (the real cause behind
  0.3); `/l/:slug` bounced signed-out visitors to sign-in before the landing could stash where
  they were; a list preview cached before sign-in kept saying "Sign in to join" after it; join
  errors showed server codes (`list_view_only`).

### Phase 1 — Foundations in `packages/ui` (M–L, unblocks everything)

Build the missing primitives, then migrate screens onto them. This is where consistency stops
being a matter of discipline.

| Primitive                                                         | Replaces                                                                | Notes                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ScreenHeader`                                                    | 13 hand-rolled headers, 5 back/close implementations                    | `leading="back" \| "close"`, title, trailing slot                              |
| `Icon` (about 12 names)                                           | about 40 unicode glyphs (`‹ ✕ ⋯ ≡ ✓ ↻ ↗ ⌕`)                             | One stroke weight; glyph metrics differ per platform font today                |
| `ListRow` + `EmojiBadge`                                          | 4 list-row copies (48/44/40/44 avatars), 8 badge copies                 | Hover, focus-visible and pressed built in                                      |
| `TextField`                                                       | 21 raw `TextInput`s, 10 copied input styles, 17 with no label           | 16px floor, wired label, error and hint                                        |
| `ActionSheet`                                                     | 5 hand-rolled menus                                                     | `items=[{label, icon, tone, onPress}]`, runs action from `onClosed`            |
| `ConfirmDialog`                                                   | `window.confirm` on web (9 sites)                                       | Same promise API as `confirm()`                                                |
| `Skeleton`                                                        | 22 bare centred spinners; there are no skeletons at all                 | `Skeleton.Row` matches `ListRow` metrics                                       |
| `Fab`, `Switch`, `RadioRow`, `SectionHeader`, `Badge`             | hand-rolled copies, some with no accessible state                       |                                                                                |
| `Text` variants `eyebrow`, `display`; headings carry a role       | 19 font sizes in use against a 6-step scale; 0 heading roles            |                                                                                |
| Tokens: `space.xxs`, `motion.{fast,base,slow,easeOut}`, `alpha()` | 73 off-scale spacing literals, 7 durations, 25 hex-alpha concatenations |                                                                                |
| `Button` / `IconButton` / `Chip`                                  | —                                                                       | 44pt hit area, hover + focus-visible, `aria-*` instead of `accessibilityState` |
| `Toast`                                                           | —                                                                       | Enter/exit motion, live region, bottom inset so it stops covering the FAB      |
| `Sheet`                                                           | —                                                                       | Max height + internal scroll; pan to dismiss or drop the handle                |

**Phase 1 status (2026-11-11): done, all 13 rows**, in the `joshlebed/ux-pass-phase-1` PR
(stacked on Phase 0). Every Workshop screen is on the primitives; they are documented in
`DESIGN.md` → Components, which later phases should treat as the vocabulary. Verified in the
running web app at 390×844 and 1440×900 on 16 routes: no control under 44×44, no input under
16px, Tab reaches every control with the accent ring, no console errors; HighScore home and a
game screen are pixel-identical. Decisions and deviations:

- `Icon` is drawn from Views. `react-native-svg` is in HighScore's native set but not
  Workshop's, so using it would force a version bump.
- The in-app `ConfirmDialog` is opt-in: `confirm()` uses it on web only where
  `ConfirmDialogHost` is mounted (Workshop). HighScore keeps `window.confirm`; native keeps
  the system alert.
- `Sheet` dropped its handle instead of gaining pan-to-dismiss (no gesture-handler in
  `packages/ui`, and a Modal needs its own gesture root). Phase 5 can revisit.
- Kept on purpose for later phases: the `⋯` list-settings control (gear is 3.4), the activity
  button's glyph (bell is 3.6), the profile sheet's structure (3.5), copy that contains glyphs
  ("tap ↻ to pull from source", "tap ⋯ → Move to ranked"), and activity's text verb marks
  (`− · ↺ ★ → ←`) that have no icon. Two spinners stay because no skeleton shape is honest:
  the auth bootstrap (destination unknown) and "Joining list…" (an action, not content).
- Extras found on the way: Escape in the list filter never cleared it (react-native-web's
  input swallows the keydown); a `Screen` `gap` never reached its children on the public
  landing; list settings flashed "Leave list" and an empty Members section while loading.
- Not verifiable on web, owed a device check: native rendering of the View-drawn icons, the
  Sheet's internal scroll with the keyboard up, Switch/RadioRow VoiceOver state, and the
  system Alert path of `confirm()`.

### Phase 2 — The core list loop (the reason people open the app)

| #    | Change                                                                                                                                                                                                   | Size | Backend                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------ |
| 2.1  | **Checkbox on every open row** when the list has completion on. One tap completes. Rank numeral sits beside it. Swipe to complete on native.                                                             | M    | —                              |
| 2.2  | **Optimistic complete / uncomplete / delete**, with the row animating to its new section.                                                                                                                | M    | —                              |
| 2.3  | **Undo toasts**: "Marked watched · Undo", "Deleted · Undo". Delete loses its confirm dialog.                                                                                                             | M    | `POST /v1/items/:id/unarchive` |
| 2.4  | **Quick add.** The add surface stays open after each add, clears, refocuses, and confirms inline. For plain lists this is a single-line composer; URL, note and tags sit behind "Details".               | M    | —                              |
| 2.5  | Pasting a URL fills the title from the preview. Search-backed lists get an `Add "query" anyway` row and Paste many. Results already on the list show "On list".                                          | S–M  | —                              |
| 2.6  | After adding, the list scrolls to and highlights the new row (the `newItemIds` mechanism exists, only source sync uses it).                                                                              | S    | —                              |
| 2.7  | **Manual order for every list** (decided: yes), not only the Ranked block. Today unranked rows show a drag handle whose drop is silently discarded.                                                      | L    | position on unranked items     |
| 2.8  | **Drag parity.** Web cannot demote by drag; native cannot drag into an empty Ranked section yet shows "Drag a row up here". Add "Move up / Move down" to the row menu (keyboard and screen-reader path). | M    | —                              |
| 2.9  | Rows show what people wrote: note wins over the fetched overview, tags as a quiet line. The cover stops being a hidden second tap target that leaves the app; "Open" moves to detail.                    | S    | —                              |
| 2.10 | Done section: expands while filtering, remembers its state, never makes a completion look like a deletion. Item count in the header excludes done.                                                       | S    | —                              |
| 2.11 | Tag bar stops jumping when a tag is selected (Save view moves to the end of the bar); chip counts reflect the current result; search matches tags.                                                       | S    | —                              |
| 2.12 | Item detail: one placeholder icon (row shows 📝, detail shows ✦), consistent input sizes, empty title restores instead of silently not saving, primary action matches the list type ("Mark watched").    | S    | —                              |
| 2.13 | List loading renders the header at once from the home cache with skeleton rows; error screens keep a back button.                                                                                        | M    | —                              |
| 2.14 | Hide phone-irrelevant chrome: the `/` and `press n` keyboard hints show only with a hardware keyboard; the search field hides on an empty list.                                                          | S    | —                              |

**Phase 2 status (2026-11-12): done, all 14 rows**, in the `joshlebed/ux-pass-phase-2` PR
(stacked on Phase 1). Verified in the running web app at 390×844 (mouse and real touch
events) and 1440×900; the iOS bundle builds, but native drag, haptics and the empty-Ranked
cell were not run on a device. Decisions and deviations:

- **2.7 data model**: a second sparse key, `items.order_key` (migration `0055`, nullable,
  no backfill), orders every open row outside the Ranked block on every list. NULL sorts
  first, newest first, so untouched lists keep recency order and new items land on top; the
  first hand placement materializes the NULLs. `POST /v1/items/:id/move` gained `section`
  (`ranked` | `unranked`); every request shape older clients send keeps its meaning.
- **2.1 placement**: checkbox leading, rank as a quiet inline figure before the title (title
  block 61% of a 390px row with a cover; numeral-leading with a trailing checkbox measured
  51% and moved the checkbox between sections). Plain lists drop the artwork tile.
- **Swipe to complete on native: skipped.** One tap on the checkbox already completes, and a
  horizontal swipe inside the reorderable list's long-press/pan could not be verified without
  a device.
- **Album shelf** keeps its recency-ordered detected block: its rows rank and unrank by drag
  but don't reorder among themselves, and a demote uses the legacy move shape.
- Out-of-scope extras: delete from item detail is act-then-undo too, and the search result
  row no longer nests a button inside a button.

### Phase 3 — Navigation and information architecture

| #   | Change                                                                                                                                                                                                                             | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 3.1 | **Home has a title and legible rows.** "Lists" title; rows show member avatars (not a 6px dot), a consistent second line (count, then last activity), a pin icon, and a Pinned divider. Search appears past about 8 lists.         | M    |
| 3.2 | **Home row actions are discoverable**: swipe on native, trailing `⋯` on hover/focus on web, long-press kept. Hide list shows an Undo toast. "Mute notifications" is renamed (there are no notifications).                          | M    |
| 3.3 | **Share is first-class.** A share button in the list header opens the native share sheet (`shareOrCopyLink`), for members too when the list allows joining. Today it is owner-only, clipboard-only, at the bottom of settings.     | M    |
| 3.4 | **List settings restructure.** Order: Share and members, Details, Features (was "Modules"), then destructive actions. Details and features autosave. The header control becomes a gear, since `⋯` means "actions" everywhere else. | M    |
| 3.5 | **Profile sheet becomes a Settings screen** with grouped rows: You, Lists (archived), Connections (Letterboxd), About (feedback, privacy, version), and admin tools in their own group at the bottom.                              | M    |
| 3.6 | **Activity deep-links to the item**, shows a "New" divider, and marks read on leave so home pips are not wiped by one visit. The header control becomes a bell. Verbs follow the glossary.                                         | M    |
| 3.7 | _Dropped._ Friends are removed from Workshop in 0.18; people reach a list through its share link only.                                                                                                                             | —    |
| 3.8 | Modal vs push made uniform per the header rule; create, join and accept flows keep home beneath the list so back works _(suspected)_.                                                                                              | S    |

**Phase 3 status (2026-11-12): done, rows 3.1–3.6 and 3.8** (3.7 dropped), in the
`joshlebed/ux-pass-phase-3` PR (stacked on Phase 2). Verified in the running web app at 390×844
and 1440×900 as an owner and as a member, keyboard-only through the home row menu, share sheet
and Settings; no control under 44×44, no input under 16px, no console errors. Decisions and
deviations:

- **Home second line, one rule for every row**: `<count in the list's own noun> · <who did
what last> · <age>` ("12 to watch · Renata added Past Lives · 2d"), or `· updated <age>`
  when the feed has no recent event. Lists with to-do count open items in their completion
  word ("3 to do", "All watched"); others use the plain noun ("4 albums"). The description no
  longer competes for the line. Unread is a count `Badge`; shared lists show up to three member
  avatars. Pinned lists sit under a "Pinned" header, the rest under "Recent".
- **Backend, one field pair**: `GET /v1/lists` gained `openItemCount` and `memberPreview` (up to
  three other members). The client reads both as optional (web persists the lists cache).
- **Share sheet shape**: one `ShareListSheet` for every entry point. Owners see the three link
  options as radio rows (save on tap, optimistic), then Share link, then a quiet Reset link
  (confirm). Members get Share link while the link is on, otherwise one line saying only the
  owner can turn it on. Share link uses the system share sheet on native and in browsers with
  Web Share, and copies with "Link copied" otherwise. Measured: **2 taps** from a list (share
  button, Share link), 3 from home (long-press or "more", Share…, Share link).
- **Settings**: `/settings` replaced the profile sheet; Edit profile and list settings are pushes
  that autosave (no Save, no Discard, nothing to lose on close). Admin tools sit in their own
  group at the bottom; while impersonating, Stop impersonating is there for the impersonated
  session too. Phase 4 adds Privacy, Terms and Delete account to About.
- **Activity**: the "New" block is computed from each list's server `unreadCount` at open (no
  new backend field) and the read marker moves when you leave. Events for deleted items are
  already hidden by the feed, so the item deep link only falls back to the list in a race.
- **Swipe actions on native: skipped.** Not verifiable without a device; long-press opens the
  same menu.
- Extras: a `hide` icon (eye with a slash); the duplicate-list and create-list flows land with
  home beneath the new list; home drops the stray `?id=` the stack anchor inherited.
- Not verifiable on web, owed a device check: the native share sheet, the back gesture after
  create/join/accept, long-press on a home row, and the system alert path of the confirms.

### Phase 4 — First run and the edges

| #   | Change                                                                                                                                                                                                                                                            | Size |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 4.1 | **Sign-in says what this is and why you are here**: one line about the product, or "Sign in to join _Date ideas_" when arriving from a share link. Display name is prefilled from the provider and has a heading.                                                 | M    |
| 4.2 | **Empty home teaches**: one sentence, three or four one-tap starter lists, and "N archived lists" when relevant.                                                                                                                                                  | M    |
| 4.3 | **Create list in one decision.** Templates grouped (Start simple, Watch and read, Plans, Import), Blank first. Name defaults to the template so Create is live immediately; look and description collapse behind "Customize". Lands in the list with add focused. | M    |
| 4.4 | **Share extension**: last-used list floats to the top, "Create new list" carries the shared link through, a signed-out share survives sign-in, and saving lands on the list with a confirmation.                                                                  | M    |
| 4.5 | **Account basics**: privacy and terms links on sign-in, delete account on Settings (the backend route exists), system Apple button on iOS. App Review risk today.                                                                                                 | M    |
| 4.6 | Invite and join error states: retry for network failures, no developer strings ("Invite link missing token"), stale stashes cleared; legacy invite tokens show the preview instead of auto-joining.                                                               | S    |

**Phase 4 status (2026-11-12): done, all 6 rows**, in the `joshlebed/ux-pass-phase-4` PR
(stacked on Phase 3). Verified in the running web app at 390×844 and 1440×900 with brand-new
scratch users; no control under 44×44, no input under 16px, no console errors. Measured: **first
list from a cold install, 3 taps + 1 text entry** (provider, name + Return, starter) and 4 taps +
2 entries to the first item; **new user joins from a link, 4 taps + 1 text entry** (Sign in to
join, provider, name, Join), landing in the list with home beneath it. Decisions and deviations:

- **One-tap create everywhere.** Templates gained a `group`, a `defaultName` ("Movies to watch")
  and sentence-case names; tapping one makes the list and opens its add surface over the list
  (`openNewList`). Owners rename in place by tapping the list name in its header. "Customize
  first" is a switch at the bottom of the picker (session memory), not a per-row control. The
  step dots moved off the picker (its step count depends on the choice) onto Customize and the
  import step, which read `step`/`steps` params.
- **Share picker saves in one tap** on lists that take a free line or a link (blank, plain,
  link); search-backed lists (movies, shows, books) and album shelves open the add surface
  prefilled (a shared title becomes the search). The last list a share went into floats to the
  top with a "Last used" badge (`workshop.share.last-list`). A signed-out share is stashed for
  24h (`workshop.pending-share`) and resumed on the picker after sign-in and the display-name
  step; its telemetry is held until there is a session.
- **Display name prefill** comes from what the client saw (Apple's full name, the Google ID
  token's `name` claim). The server already saves a provider name when it gets one, so the step
  only shows when there was none; no backend change.
- **Legacy `/invite/:token`** is now a real landing (same preview card as `/l/:slug`, explicit
  Join); `/onboarding/accept-invite` redirects to it. The invite stash clears on join, on a
  definite 404, or once a signed-in viewer has the preview; a network failure keeps it.
- **Privacy and Terms** are new Workshop pages (`/privacy`, `/terms`), public in any auth state,
  modelled on HighScore's copy. The operator should review the text.
- **Found and fixed:** `GET /v1/lists` dropped every list whose `item_kind` is NULL (Blank
  lists): `NOT (… OR item_kind = 'game')` is NULL for them. "Start from scratch" lists vanished
  from home. A PGlite test pins it.
- **Checked on the iOS simulator** (new `workshop` target in `.niteshift/mobile.yaml`): the
  system Apple button renders and opens Apple's sheet. That run found two fixes: the sign-in
  screen crashed on iOS when no Google iOS client id was set (Google now renders only when
  configured), and closing Apple's sheet said "Couldn't reach Workshop" (only a fetch
  `TypeError` is a network error now).
- Still owed a device check: the native share extension hand-off into the signed-out stash and
  `KeyboardAvoidingView` on the display-name step.

### Phase 5 — Polish and accessibility

| #   | Change                                                                                                                                                                             | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 5.1 | **Copy pass** against the glossary and `PRODUCT.md` voice: sentence case template names, no em dashes or exclamation marks in toasts, no jargon ("source", "module", "uncrossed"). | S    |
| 5.2 | **Motion**: rows move between sections, sections collapse, toasts enter and leave, all on the three motion tokens with reduced-motion respected.                                   | M    |
| 5.3 | **Haptics map**: selection for toggles and pickers, success for creates, warning for destructive confirms. Settings and create flows have none today.                              | S    |
| 5.4 | **Type and spacing sweep** onto the scale once the `eyebrow` variant and `space.xxs` exist.                                                                                        | M    |
| 5.5 | **Accessibility to AA**: labels on all inputs, state on switches and radios, announced toasts, keyboard reorder, focus-visible everywhere on web.                                  | M    |
| 5.6 | _Deferred._ Light mode stays off; 0.15 pins the app to dark. Revisit as its own project (primitives on `useTheme()`, light-specific accent and status text tokens).                | —    |
| 5.7 | **Desktop web**: the page scrolls instead of an inner box, hover states, and a two-pane layout (lists left, list right) above about 900px.                                         | L    |

**Phase 5 status (2026-11-12): done, rows 5.1–5.5 and 5.7 (all three parts; 5.6 deferred by
decision)**, in the `joshlebed/ux-pass-phase-5` PR (stacked on Phase 4). Verified in the running web
app at 390×844, 1440×900, 200% zoom and 320px wide with reduced motion, keyboard-only, with axe on
22 routes, the full Playwright suite (now on scratch users only), and on the iOS simulator. HighScore
home and a game screen are pixel-identical before and after. Decisions and deviations:

- **5.7c two-pane, built**: `TwoPaneShell` (web, ≥900px) renders the `(lists)` stack in a right
  pane beside `HomeLists variant="sidebar"`. The sidebar is chrome, not a route, so URLs,
  back/forward, deep links and reload are the stack's own (`tests/e2e/desktop.spec.ts`); item
  detail, add, settings and the create flow push inside the pane; sheets are centred dialogs from
  720px. Picking a list in the sidebar replaces the open one (home stays beneath), so browser
  back from list B goes to the "Open a list" placeholder, not to list A: the stack stays two deep
  instead of growing with every click. Below 900px, and for someone with no lists, the phone
  layout is untouched. Activity, sign-in and the share picker stay single column (root stack).
- **5.7a page scroll**: the scroll view of every screen spans its pane, so the scrollbar is at
  the window edge and the wheel works anywhere; content is held to the 560 column. The header
  (and list search) stays put above it. A true document scroll would fight react-navigation's
  stack cards.
- **5.7b**: one shortcut catalog (`src/lib/shortcuts/`) feeds the handlers and the `?` sheet
  (also Settings → Keyboard shortcuts): `/` or ⌘K, `N`, Escape, ⌘Enter, ⌘Z (Undo while its toast
  shows), ⌘/, `?`. None fire while typing, while a sheet is open, or on a screen underneath; the
  old home ⌘N fired from underneath list detail and Chrome swallows ⌘N anyway, so new list is `N`.
- **List detail pins only a compact bar** (review follow-up): the title block, search field
  and tag bar scroll with the rows; the bar keeps back, share and settings, fades the list name
  in once the title has gone and then offers search, or a chip for an active filter. At rest the
  page looks as before (first row at y≈270 at 390×844 on a list with a tag bar); once scrolled,
  only the 56pt bar stays pinned instead of everything above the rows.
- **Toast rule (carry-over 3)**: opening a new screen dismisses the toasts raised before it;
  going back keeps them (item detail's "Deleted · Undo" survives the trip back to the list).
- **Tick hold**: a ticked row stays in place, checked, for 1.2s, then moves to Done; ticks in a
  row land together and an untick inside the hold sends nothing (the critique's error-prevention
  finding). The write is sent when the hold ends, or at once when the screen or app is left.
- **Contrast**: `text.muted` #86817C → #908B87 and a new `border.control` #726E6A (≥3:1 on every
  surface) for every control edge; HighScore's shared Google button keeps its old edge.
- **Found and fixed**: a reload within 30s showed stale data (the restored cache counted as
  fresh); failed writes stacked three contradictory toasts with raw "Failed to fetch"; the iOS
  keyboard was light; every `SectionHeader` rendered as an `<h1>`; Space didn't toggle checkboxes,
  switches or radios on web; home and list emoji/color pickers were two implementations.

## 4. Sequencing

```
Phase 0 (bugs) ──► first
Phase 1 (ui primitives) ──► then in parallel:
    Phase 2 (list loop)      ← highest user value, start first
    Phase 3 (navigation/IA)
    Phase 4 (first run/edges)
Phase 5 (polish) ──► last, once screens are on the primitives
```

Each row above is one PR-sized change. Phases 2–4 touch mostly disjoint files (list detail vs
home/settings/activity vs sign-in/create/share), so they suit separate tasks stacked on Phase 1.
Backend work is limited to 2.3 (item unarchive) and 2.7 (position for unranked items).

## 5. How we will know it worked

| Journey                        | Today                                                | Target                     |
| ------------------------------ | ---------------------------------------------------- | -------------------------- |
| Complete an item               | 2 taps + sheet, no feedback until the server answers | 1 tap, instant, undoable   |
| Add five plain items           | 15 taps, 5 modal round trips                         | 2 taps + five Returns      |
| Share a list                   | 3 taps, clipboard only, owner only                   | 2 taps, native share sheet |
| New user joins from a link     | 4 taps, then the list is lost                        | 4 taps, lands in the list  |
| First list from a cold install | 5 taps + 2 text entries                              | 4 taps + 1 text entry      |
| Undo a mistake                 | not possible                                         | every reversible action    |

Re-run the heuristic critique after Phases 2 and 5. Add Playwright coverage for the five journeys
above as each lands, so they cannot regress.

## 6. Glossary (one word per thing)

| Concept                    | Use                                                                | Stop using                                         |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| Hand-ordered block         | **Ranked**; "Rank at top", "Rank at bottom", "Remove from ranking" | ordered, unordered, pinned (in activity)           |
| Completion                 | The list's own word everywhere: **Watched / Read / Tried / Done**  | Mark complete, Mark incomplete, uncrossed          |
| Removing an item or a list | **Delete**, always in `status.danger`                              | Remove this item, archive (in errors and activity) |
| Per-viewer hide of a list  | **Hide** / Hidden lists                                            | Archive (collides with delete in activity)         |
| Letting someone in         | **Share link**; the recipient **joins**                            | invite (reserved for friends)                      |
| People on a list           | **Members**                                                        | collaborators                                      |
| Optional list behaviours   | **Features**                                                       | modules                                            |
| Silencing unread dots      | **Mute activity**                                                  | Mute notifications                                 |

## 7. Decisions (2026-11-11)

1. **Friends in Workshop**: remove the surface. No friend management in Workshop; multiplayer is per list (0.18).
2. **Light mode**: pinned dark for now (0.15); 5.6 deferred.
3. **Manual order on every list**: yes (2.7).

## 8. Delivery

One Graphite stack, one PR per phase, each verified in the running app before the next starts:
plan (#585) ← phase 0 ← phase 1 ← phase 2 ← phase 3 ← phase 4 ← phase 5. Nothing merges until the
human review pass at the end.

## 9. Final status (2026-11-12)

The pass is done through Phase 5; nothing is merged yet (human review of the whole stack first).

**Nielsen heuristics** (impeccable `critique`, scored 0–4 by an independent reviewer walking every
route as a new and an existing user at 390×844 and 1440×900; the automated detector found 0
anti-patterns on 221 files and 10 page views):

| #   | Heuristic                   | Baseline  | After Phase 5 | Final     | Still holding it down                                                         |
| --- | --------------------------- | --------- | ------------- | --------- | ----------------------------------------------------------------------------- |
| 1   | Visibility of system status | 2         | 3             | 3         | No Saving/Saved in item detail; writes queued offline show no "will save" cue |
| 2   | Match with the real world   | 2         | 3             | 4         | Nits (⌘ shown on Linux)                                                       |
| 3   | User control and freedom    | 1         | 3             | 3         | Undo windows 5–6s; Back from Hidden lists lands on Settings                   |
| 4   | Consistency and standards   | 1         | 3             | 3         | Tag/note placeholders differ; toast centred on the window, not the pane       |
| 5   | Error prevention            | 1         | 3             | 4         |                                                                               |
| 6   | Recognition over recall     | 2         | 3             | 3         | Save view sits at the end of the tag strip, off-screen at 390                 |
| 7   | Flexibility and efficiency  | 2         | 3             | 3         | No arrow keys between rows                                                    |
| 8   | Aesthetic and minimalist    | 3         | 3             | 3         | List settings shows features that don't fit the list type                     |
| 9   | Error recovery              | 2         | 2             | 3         | A 500 has no Retry; the Spotify link error doesn't mark the field             |
| 10  | Help and documentation      | 3         | 3             | 3         |                                                                               |
|     | **Total**                   | **19/40** | **29/40**     | **32/40** | Target 32+: met                                                               |

The baseline column is the plan's 19/40 estimate; its per-heuristic split is reconstructed from
§1. Cognitive load: 2 of 8 checks fail (row menu choices, list settings features).

**Audit dimensions** (0–4): accessibility 3 (axe: 0 findings of any severity on 22 routes at both
widths, keyboard-only journeys complete; VoiceOver unverified on a device, radio groups move by
Tab), performance 3 (transform/opacity motion only, no jank seen; not profiled), theming 3 (tokens
everywhere, 19 deliberate off-scale literals; dark only by decision), responsive 4 (44pt targets,
16px inputs, 320px reflow, 200% zoom, desktop two-pane), anti-patterns 3 (detector clean; the
emoji-in-a-tinted-disc mark repeats on every screen). **16/20.**

**Journeys (§5), measured** at 390×844; each also completed keyboard-only at 1440×900:

| Journey                        | Before the pass                                      | Target                     | Measured                                               |
| ------------------------------ | ---------------------------------------------------- | -------------------------- | ------------------------------------------------------ |
| Complete an item               | 2 taps + sheet, no feedback until the server answers | 1 tap, instant, undoable   | 1 tap, instant, Undo toast (⌘Z on web)                 |
| Add five plain items           | 15 taps, 5 modal round trips                         | 2 taps + five Returns      | 2 taps + five Returns                                  |
| Share a list                   | 3 taps, clipboard only, owner only                   | 2 taps, native share sheet | 2 taps, system share sheet (copy where there is none)  |
| New user joins from a link     | 4 taps, then the list is lost                        | 4 taps, lands in the list  | 4 taps + 1 text entry, lands in the list, home beneath |
| First list from a cold install | 5 taps + 2 text entries                              | 4 taps + 1 text entry      | 3 taps + 1 text entry                                  |
| Undo a mistake                 | not possible                                         | every reversible action    | 1 tap on the toast: complete, delete, move, rank, hide |

**Known gaps left** (in scope but not done, or product calls): which features list settings offers
per list type; activity not batched; no Saving/Saved in item detail; Undo windows don't pause on
native; native swipe actions (2.1, 3.2) were never built; arrow-key row navigation.

**Needs a physical device** (collected from Phases 0–5):

- iOS haptics everywhere (complete, add, creates, joins, destructive confirms, selection, per-slot
  ticks while dragging) and the Sheet under iOS Reduce Motion.
- Native drag: long-press thresholds on a real touchscreen, the empty-Ranked slot cell, the drop
  slide; the double scale on a lifted row (library 1.025 × row 1.02).
- The iOS Modal/Alert race when a sheet chains into a confirm (0.13) and the system Alert path of
  `confirm()`; native status-bar glyphs on a light-mode phone (0.15).
- VoiceOver: announcements (toasts, Move up / Move down), rows read by their own text, the home
  row label, expanded state of Done, Switch/RadioRow state.
- The native share sheet (3.3), the back gesture after create / join / accept (3.8), long-press on a
  home row.
- The share extension hand-off into the signed-out stash and its resume after sign-in (4.4);
  keyboard avoidance on the display-name step; real Apple / Google sign-in and the provider-name
  prefill; Spotify / Letterboxd import creation.
- Native multiline inputs growing with text and the emoji glyph sizes at large Dynamic Type.

Checked on the iOS simulator in Phase 5 (not a device): home, list detail, quick add with
Return, long-press reorder and scroll after it, delete + Undo, a sheet above the keyboard, the
row menu, the tick hold, the dark keyboard, and names/roles/states in the accessibility tree.

**Operator actions**:

- Review the legal text in `apps/workshop/src/lib/legal.ts` (`/privacy`, `/terms`), then set
  `https://workshop-a2v.pages.dev/privacy` as Workshop's privacy policy URL in App Store Connect.
- Flip `app.json` `userInterfaceStyle` to `dark` with the next native version bump (0.15 pinned dark
  in JS only to keep the OTA path open), and drop the leftover `EXPO_PUBLIC_ENABLE_GAMES` /
  `expo-haptics` cleanups that need a native bump.
- Decide which list features list settings should offer per list type.
