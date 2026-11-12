# Workshop — usability pass: audit and engineering plan

Status: approved 2026-11-11, in progress · Opened: 2026-11-11 · Scope: `apps/workshop` + `packages/ui` (HighScore untouched)

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

### Phase 4 — First run and the edges

| #   | Change                                                                                                                                                                                                                                                            | Size |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 4.1 | **Sign-in says what this is and why you are here**: one line about the product, or "Sign in to join _Date ideas_" when arriving from a share link. Display name is prefilled from the provider and has a heading.                                                 | M    |
| 4.2 | **Empty home teaches**: one sentence, three or four one-tap starter lists, and "N archived lists" when relevant.                                                                                                                                                  | M    |
| 4.3 | **Create list in one decision.** Templates grouped (Start simple, Watch and read, Plans, Import), Blank first. Name defaults to the template so Create is live immediately; look and description collapse behind "Customize". Lands in the list with add focused. | M    |
| 4.4 | **Share extension**: last-used list floats to the top, "Create new list" carries the shared link through, a signed-out share survives sign-in, and saving lands on the list with a confirmation.                                                                  | M    |
| 4.5 | **Account basics**: privacy and terms links on sign-in, delete account on Settings (the backend route exists), system Apple button on iOS. App Review risk today.                                                                                                 | M    |
| 4.6 | Invite and join error states: retry for network failures, no developer strings ("Invite link missing token"), stale stashes cleared; legacy invite tokens show the preview instead of auto-joining.                                                               | S    |

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
