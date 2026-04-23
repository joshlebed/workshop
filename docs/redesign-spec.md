# Workshop.dev — Redesign Spec

Status: proposed · Date: 2026-04-23 · Owner: @joshlebed

This is the product spec and high-level design for the rewrite of Workshop.dev's first
feature. It captures every decision made during the product/design interview on 2026-04-23.
The existing `watchlist` feature (dark UI, category-tabs, count-on-duplicate-add, 300-line
home screen) is being replaced end-to-end — UI, data model, API, and feature surface.

The codebase/infra foundation stays: pnpm monorepo, Expo (RN) + expo-router on iOS and web,
Hono on Lambda, Neon Postgres, Drizzle, Terraform, EAS. See `docs/decisions.md` for the
reasoning behind those and `CLAUDE.md` for the operational conventions. This document does
not re-litigate those.

---

## 1. Product vision

Workshop.dev is a **group list app** for tracking things a small circle of people want to
do together: movies to watch, books to read, date ideas, trips to plan. Every list is
shared by design. Every list has a type; items on the list match that type and are
enriched automatically with posters, covers, or link previews.

The core loop: someone adds an item → it appears on a shared list → members upvote → the
top-of-list reflects group consensus → someone marks it complete when the group has done
it. Items live inside lists; lists live inside groups; groups and lists are 1:1.

Target user: a person in several small friend/partner/family groups who wants one place
to collect what those groups want to do, without the social-media overhead of public
feeds or follow graphs.

### Non-goals

- Public profiles, follow graph, discoverability.
- Cross-list recommendation surfacing / "for you" ranking.
- User-to-user DMs or direct recommendations.
- Downvotes, "disinterested," or negative-signal voting.
- Rich per-item threaded conversation.
- Calendar integrations, planning tools beyond the list itself.
- AI suggestions or auto-adding.
- Multi-list membership for a single item (items belong to exactly one list).

---

## 2. Product model

### 2.1 Lists

A **list** is the top-level unit of shared content. A list has:

- `id` — UUID.
- `type` — one of `movie`, `tv`, `book`, `date_idea`, `trip`. **Immutable after creation.**
- `name` — human title (required).
- `emoji` — single emoji, picked by the creator, used as the list's visual token.
- `color` — palette color, used as the card accent on the home screen.
- `description` — optional short blurb (≤280 chars).
- `owner_id` — user who created the list; cannot leave.
- `metadata` — JSONB for future type-specific list-level fields (e.g., trip date range).
- `created_at`, `updated_at`.

Lists are **1:1 with groups**. Adding a person to a list is how you "create a group."
There is no standalone group entity — membership is a per-list relation.

### 2.2 Items

An **item** is a single thing on a list. Every item has:

- `id` — UUID.
- `list_id` — the parent list (FK, immutable).
- `type` — denormalized from the list's type, for convenient queries.
- `title` — **required**, ≤500 chars.
- `url` — optional, single URL.
- `note` — optional, freeform string (≤1000 chars), editable by any member,
  last-writer-wins.
- `added_by` — user who first created the item.
- `completed` — bool; default false.
- `completed_at` — timestamp; null unless completed.
- `metadata` — JSONB. Per-type shape validated by zod at the app layer. See §9.
- `created_at`, `updated_at`.

### 2.3 Upvotes

- An **upvote** is a `(item_id, user_id)` pair in `item_upvotes`.
- When a user adds an item, the backend also inserts the creator's upvote in the same
  transaction. The count starts at 1.
- A user can toggle their own upvote on/off. The item stays on the list at count 0.
- There are no downvotes.
- **Sort order within a list**: `upvote_count DESC, created_at DESC`.

### 2.4 Completion

- `completed` is a **single shared boolean** per item. Not per-user.
- Any member can mark complete or uncomplete.
- Completed items are **still shown on the list**, in a "Completed" section at the
  bottom, visually greyed out. Same scroll container — no separate tab.
- Completed items sort by `completed_at DESC`.

### 2.5 Permissions

- **Owner**: the user who created the list.
  - Can rename, change emoji/color/description, invite, remove members, delete the list.
  - **Cannot leave** the list — only delete it.
- **Member**: any user added via invite.
  - Can add, edit (title, URL, note, metadata), delete any item.
  - Can upvote/unvote any item.
  - Can mark any item complete or uncomplete.
  - Can leave the list at any time (removes their upvotes; items they added stay, with
    the `added_by` attribution preserved).
- There is **no viewer-only role** in v1.

### 2.6 Invites

Two mechanisms, both available on every list:

1. **Share link** — owner generates a revocable deep link (`workshop.dev/invite/:token`).
   Recipient taps, signs in (magic code if new), auto-joins. Tokens are single-list scoped
   and revocable from the list info screen.
2. **Email invite** — owner enters an email address.
   - If the email belongs to an existing user: they're added immediately.
   - If not: we send a magic-link email ("Josh invited you to Movie Night. Tap to
     join."). They sign in via magic code and are auto-joined. Until they accept, the
     invite shows in the member list as a pending placeholder (email shown instead of
     display name).

---

## 3. Information architecture

```
Root
├── Sign in (email → 6-digit code → display-name prompt if new)
├── Home ("Your Lists")
│   ├── Header: app title, notifications button, settings button
│   ├── List cards (emoji + color + name + type icon + item count)
│   └── FAB: "Create list"
├── List detail (/list/:id)
│   ├── Header: back, emoji + name, info button (→ List settings)
│   ├── Filter bar: client-side search-as-you-type
│   ├── Items (rich cards, sorted by upvotes)
│   ├── Completed section (greyed, at bottom)
│   └── FAB: "Add item"
├── Item detail (/list/:id/item/:itemId)
│   ├── Hero: thumbnail/poster/OG image
│   ├── Title, metadata strip, URL preview, note
│   └── Actions: upvote, complete, edit, delete
├── Add item flow (modal stack, type-aware)
├── List settings (modal/sheet from info button)
│   ├── Name, emoji, color, description
│   ├── Members (add/remove, role) + pending invites
│   ├── Share link (copy/revoke)
│   └── Danger: delete list
├── Notifications (cross-list activity feed, accessed from home header)
├── Settings (profile, display name, sign out)
└── Create list flow (type picker → name/emoji/color → optional invite → land in empty list)
```

---

## 4. UX details

### 4.1 Home — "Your Lists"

- Single screen showing all lists the user owns or is a member of.
- **Empty state** (first-time or no lists): centered CTA "Create your first list"
  with a one-line hint. No guided wizard, no seeded demo data.
- **Populated state**: vertical stack of rich cards. Each card:
  - Large emoji on the left (the list's visual anchor).
  - Color as accent (left border or subtle background tint; exact treatment is design
    polish, but every list is visually distinct at a glance).
  - Name (primary), description (secondary, one line, truncated).
  - Type icon (subtle) + item count ("12 items · 3 members").
  - Tap anywhere on the card → list detail.
- Header right: notifications bell (badge when there are unread events) and settings
  gear.
- Floating "+" → create-list flow.

### 4.2 List detail

- Header contains emoji + name and an info button (opens list settings).
- Client-side filter input directly under the header — substring match on title and
  note, filters the rendered list in place. Pointless server round-trip at v1 scale.
- Primary section: items sorted by `upvote_count DESC, created_at DESC`.
- **Completed section** below the primary section, collapsible, header shows count
  ("Completed (7)"). Items inside are greyed and show `completed_at` instead of
  `added_by`.
- **Card anatomy** (rich card, Option B from the interview):
  - 96–120pt tall.
  - Thumbnail on the left (poster for movies/TV, cover for books, OG image for URLs,
    emoji fallback for date ideas/trips with no URL).
  - Title as the primary line; one metadata line below (year + runtime, author + year,
    hostname, etc.); "added by @name" footer.
  - Upvote pill on the right: tappable; shows count; visual "selected" state when the
    current user has upvoted.
  - Tap anywhere except the upvote pill → item detail screen.
- FAB "+" opens the add flow.

### 4.3 Item detail

- Full-screen (push from list detail).
- Hero: large thumbnail/poster, fallback solid color with emoji if no image.
- Title.
- Metadata strip: whatever the type carries (e.g., "Movie · 2024 · 2h 46m · directed
  by Denis Villeneuve").
- URL, rendered as a tappable preview card (same OG data the cache already has).
- Editable note field (inline edit; save on blur; last-writer-wins).
- Primary actions in a row: upvote toggle, mark complete/uncomplete.
- Overflow menu: edit title, delete.

### 4.4 Add-item flow

Type-aware modal stack. Entry point is always the "+" FAB on a list.

- **Movie / TV list**: full-screen search modal. Input box; debounced live search
  against `/search/media?type=movie|tv&q=...` (backend proxies TMDB). Results as
  rows with poster + title + year + runtime. Tap a result → confirm screen. "Can't
  find it?" link at the bottom drops to a free-form add.
- **Book list**: same pattern, backend proxies Google Books.
- **Date idea / trip list**: free-form add screen. Fields: title (required), URL
  (optional), note (optional). If a URL is pasted, we fetch the link preview on
  blur and display the scraped thumbnail/title inline. User can accept or edit
  the fetched title.
- **Confirm screen** (shared across paths): title is always editable and required;
  URL optional; note optional; "Add" button commits.
- **iOS share extension**: Native share extension receives a URL (and optional
  shared text). Shows a list picker (or "Create new list" option). On pick,
  deep-links into the confirm screen with URL prefilled and, if the list type is
  movie/tv/book, an attempt to parse a known URL (tmdb.org, imdb.com,
  books.google.com, openlibrary.org) into a structured match. Falls back to
  free-form-with-link-preview for anything else.
- **Web**: no share extension. The add flow's URL field behaves identically —
  paste a URL, get a link preview, save. Same code path.

### 4.5 Create-list flow

Modal stack, 2–3 screens:

1. **Type picker** — 5 big cards, each with emoji + label ("Movies", "TV",
   "Books", "Date Ideas", "Trips"). Pick one. Type is then immutable.
2. **Customize** — name (required), emoji (default pre-picked by type, overridable),
   color (palette, default random), optional description.
3. **Invite** — "Invite friends now?" with email input (can add multiple) and a
   copy-link button. **Skippable**; user can always invite later from list
   settings.
4. Land in the new empty list, ready to add the first item.

### 4.6 Onboarding / NUX

- Sign-in: email → 6-digit magic code (unchanged from current).
- **First-time only**: after code verification, a single-field "What should we call
  you?" screen. Placeholder is email local-part. Required, ≤50 chars, saved to
  `users.display_name`, editable later in Settings.
- No tutorial, no demo content. Land in Home empty state with the "Create your
  first list" CTA.

### 4.7 Notifications / activity feed

- Accessed from the bell icon in the home header.
- Cross-list chronological feed of events the user cares about, scoped to lists
  they're a member of.
- Event types (v1): `item_added`, `item_completed`, `item_uncompleted`,
  `member_joined`, `member_left`, `list_renamed`.
- Each row: actor (display name + initials avatar), verb, target (with list
  context), relative timestamp. Tapping navigates to the relevant list or item.
- **No push notifications** in v1.
- Unread indicator: last-read timestamp per user; badge = count of events newer
  than that; tapping the bell marks read.
- Retention: unbounded in v1; paginate at 50/page.
- Per-list activity view available in list settings (filtered subset).

### 4.8 Settings

- Profile: display name (editable), email (read-only), avatar (initials only in v1).
- Sign out.
- App version + build info.

### 4.9 List settings / info

Opened via the info button in the list detail header. Modal sheet (mobile) or right
pane (web desktop). Sections:

- **Details** — name, emoji, color, description (owner-editable).
- **Members** — list of members with display name + initials + role. Owner can
  remove members. Non-owners see a "Leave list" button here.
- **Pending invites** — shown if the list has unaccepted email invites, with a
  "revoke" action.
- **Share link** — copy / regenerate (regenerating revokes the previous token).
- **Activity** — last 20 events on this list; deep-link to the cross-list feed.
- **Danger zone** — "Delete list" (owner only). Confirmation dialog; hard delete
  cascades to items, upvotes, activity, invites.

---

## 5. Design system

### 5.1 Theme

- **System-driven** via `useColorScheme()`. All colors come from a theme token
  object (`theme.dark`, `theme.light`) accessed through a `useTheme()` hook.
- **Ship dark first**, matching the current app's palette (polished). Light mode
  tokens live in the same file; flip is a v1.1 concern.
- Token categories: background (base, elevated, overlay), text (primary,
  secondary, tertiary, on-accent), border (subtle, strong), accent (primary,
  danger, success), interactive states (hover, pressed, disabled).
- Semantic colors referenced exclusively through tokens. No hex literals in
  component code.

### 5.2 Typography

- System font stack (SF Pro on iOS, `system-ui` on web). No custom web fonts in v1.
- Type scale (semantic, not numeric): `display`, `headline`, `title`, `body`,
  `label`, `caption`. Rendered sizes calibrated for mobile density first, scaled
  slightly for desktop.

### 5.3 Primitives library

Located in `apps/workshop/src/ui/`. Each primitive owns its own styles via
`StyleSheet.create` and consumes theme tokens:

- `Text` — wraps RN `Text` with variant (`display | headline | title | body |
  label | caption`), color token, and weight.
- `Button` — variants `primary | secondary | ghost | danger`; sizes `sm | md | lg`;
  loading + disabled states.
- `IconButton` — square tap target, icon-only.
- `Card` — surface + padding + radius tokens.
- `Sheet` — bottom-sheet modal with backdrop; respects safe areas; animated via
  `react-native-reanimated` (already a dep).
- `Modal` — full-screen stack modal.
- `TextField` — labeled input with validation-error rendering.
- `Avatar` — initials-only circle with deterministic color.
- `UpvotePill` — composite button showing state + count.
- `Chip` — for type tags, category filters.
- `EmptyState` — icon + headline + subcopy + CTA button.
- `Toast` / `Snackbar` — for transient success/error feedback (replaces the red
  banner pattern currently in the app).

No third-party component library (Tamagui, Gluestack, etc.) — rejected in the
interview. Owned primitives + `react-native-reanimated` + `expo-haptics` cover it.

### 5.4 Layout (mobile + web)

- **Mobile (<768px wide)**: single-column stack. Bottom-sheet modals for add/edit.
  Safe-area respected everywhere.
- **Desktop (≥768px)**: two-pane layout. Left pane (~320px) is the list of lists
  with the selected list highlighted. Right pane is the list/item detail. Modals
  (add, create, settings) open centered over the right pane. Collapses to mobile
  stack at narrow widths.
- Navigation on desktop uses a persistent sidebar; mobile uses stack navigation
  with back buttons.

### 5.5 Interaction feel

- Haptics: light impact on upvote toggle, success on complete, warning on
  delete-confirm (iOS; web is a no-op).
- Optimistic updates everywhere (upvote, complete, add, edit). On mutation error,
  revert with a toast.
- Pull-to-refresh on list views.
- Swipe-to-complete and swipe-to-delete on list-item rows (iOS/Android); context
  menu on web.

---

## 6. Technical architecture

### 6.1 Client stack

- **Framework**: Expo SDK 55, expo-router (file-based routing), React Native
  0.83.6, TypeScript. Unchanged from the current app.
- **Web**: `react-native-web` with the existing `.web.ts` convention for platform-
  specific modules. No divergent component tree — layout differences are
  expressed as responsive styles and conditional rendering in the two-pane
  container.
- **Server state**: [TanStack Query](https://tanstack.com/query) (v5). Every
  server-dependent screen gets a `useQuery` for reads and `useMutation` with
  optimistic updates for writes.
- **Persistence**: TanStack Query's `persistQueryClient` hooked to AsyncStorage
  (iOS) and `localStorage` (web). Gives read-offline on cold start. Writes
  require network; mutations in a disconnected state show inline retry.
- **Auth state**: React Context, token in `expo-secure-store` (iOS) /
  `localStorage` (web), same split as today.
- **Forms**: controlled `useState` per form. No form library — v1 forms are
  small enough that a library is overhead.
- **Styling**: StyleSheet + theme tokens. No CSS-in-JS.
- **Animation**: `react-native-reanimated` (already a dep), used for sheet
  transitions, upvote pulse, completion cross-out.
- **iOS share extension**: Expo config plugin that adds a Share Extension target
  to the native iOS project. The extension writes the shared URL to an app group
  `UserDefaults`, then opens the main app via a custom URL scheme
  (`workshop://share?url=...`). The main app's deep-link handler reads the URL
  and navigates into the add flow.

### 6.2 Backend stack

- **Framework**: Hono on AWS Lambda behind API Gateway HTTP API. Unchanged.
- **Database**: Neon Postgres (serverless). Unchanged. Drizzle ORM with
  `postgres-js` driver. `max: 1` connection per Lambda container.
- **Validation**: Zod at every route boundary, both request and response. Shared
  types live in `@workshop/shared`; Zod schemas derived from or compatible with
  those types.
- **Auth**: Existing HMAC session-token flow, extended to return and accept
  `display_name` on the user profile. Magic-link codes unchanged (15-min TTL,
  6-digit, hashed server-side).
- **Email**: AWS SES, already wired. New templates for list invites.
- **Infra**: Terraform additions as needed for SES identities (if new), SSM
  parameters for TMDB / Google Books API keys, and an S3 bucket is **not**
  needed in v1 (no user image uploads).

### 6.3 Deployment

- OTA via EAS Update for JS-only changes.
- Native build triggered by expo-fingerprint on any change to the share
  extension or other native config.
- Web deployed as part of the Expo web bundle — needs an actual hosting story
  (not covered in v1 interview, see Open Questions §16).

---

## 7. Data model

The old `rec_items` / `magic_tokens` / `users` schema is **wiped** (user opted to
drop existing data). The new schema:

### 7.1 `users`

| column         | type                      | notes                       |
|----------------|---------------------------|-----------------------------|
| id             | UUID PK                   | `gen_random_uuid()`         |
| email          | text NOT NULL             | UNIQUE on `lower(email)`    |
| display_name   | text NOT NULL             | collected on first sign-in  |
| created_at     | timestamptz NOT NULL      | default `now()`             |
| updated_at     | timestamptz NOT NULL      | default `now()`             |

### 7.2 `magic_tokens`

Same shape as today. Consumed single-use, 15-min TTL. Add a nightly cleanup job
(Lambda scheduled event) to delete expired + consumed rows older than 7 days.

### 7.3 `lists`

| column         | type                          | notes                               |
|----------------|-------------------------------|-------------------------------------|
| id             | UUID PK                       |                                     |
| type           | list_type enum NOT NULL       | `movie\|tv\|book\|date_idea\|trip`  |
| name           | text NOT NULL                 | ≤100 chars (app-layer)              |
| emoji          | text NOT NULL                 | single grapheme                     |
| color          | text NOT NULL                 | palette key (e.g., `indigo`)        |
| description    | text                          | nullable, ≤280 chars                |
| owner_id       | UUID NOT NULL                 | FK `users.id` ON DELETE RESTRICT    |
| metadata       | jsonb NOT NULL DEFAULT '{}'   | future type-specific list fields    |
| created_at     | timestamptz NOT NULL          |                                     |
| updated_at     | timestamptz NOT NULL          |                                     |

Indexes: `owner_id`, `(owner_id, updated_at DESC)`.

### 7.4 `list_members`

| column         | type                      | notes                                     |
|----------------|---------------------------|-------------------------------------------|
| list_id        | UUID NOT NULL             | FK `lists.id` ON DELETE CASCADE           |
| user_id        | UUID NOT NULL             | FK `users.id` ON DELETE CASCADE           |
| role           | member_role NOT NULL      | `owner \| member`                         |
| joined_at      | timestamptz NOT NULL      |                                           |
| PK             | (list_id, user_id)        |                                           |

Indexes: `user_id` (for "lists I'm a member of" query).

Invariant: exactly one `owner` per list. Enforced at the app layer; the DB
constraint is a partial unique index on `(list_id) WHERE role = 'owner'`.

### 7.5 `list_invites`

| column         | type                      | notes                                     |
|----------------|---------------------------|-------------------------------------------|
| id             | UUID PK                   |                                           |
| list_id        | UUID NOT NULL             | FK `lists.id` ON DELETE CASCADE           |
| email          | text                      | null if this is a share-link invite       |
| token          | text NOT NULL             | UNIQUE; used in the share/email URL       |
| invited_by     | UUID NOT NULL             | FK `users.id`                             |
| accepted_at    | timestamptz               | null while pending                        |
| revoked_at     | timestamptz               | null unless revoked                       |
| created_at     | timestamptz NOT NULL      |                                           |

Indexes: `list_id`, `email`, `token` (unique).

### 7.6 `items`

| column         | type                          | notes                                   |
|----------------|-------------------------------|-----------------------------------------|
| id             | UUID PK                       |                                         |
| list_id        | UUID NOT NULL                 | FK `lists.id` ON DELETE CASCADE         |
| type           | list_type NOT NULL            | denormalized; must equal `lists.type`   |
| title          | text NOT NULL                 | ≤500 chars                              |
| url            | text                          | ≤2048 chars                             |
| note           | text                          | ≤1000 chars                             |
| metadata       | jsonb NOT NULL DEFAULT '{}'   | per-type shape (see §9)                 |
| added_by       | UUID NOT NULL                 | FK `users.id` ON DELETE RESTRICT        |
| completed      | boolean NOT NULL DEFAULT false|                                         |
| completed_at   | timestamptz                   | null unless completed                   |
| completed_by   | UUID                          | FK `users.id`; null unless completed    |
| created_at     | timestamptz NOT NULL          |                                         |
| updated_at     | timestamptz NOT NULL          |                                         |

Indexes: `list_id`, `(list_id, completed, created_at DESC)`.

No unique constraint on title within a list — users can intentionally duplicate
(rare, but we don't block it; upvotes handle dedupe socially).

### 7.7 `item_upvotes`

| column         | type                      | notes                                     |
|----------------|---------------------------|-------------------------------------------|
| item_id        | UUID NOT NULL             | FK `items.id` ON DELETE CASCADE           |
| user_id        | UUID NOT NULL             | FK `users.id` ON DELETE CASCADE           |
| created_at     | timestamptz NOT NULL      |                                           |
| PK             | (item_id, user_id)        |                                           |

Indexes: `user_id`.

Item `upvote_count` is a computed aggregate, not a stored column in v1. Listing
items uses a single query: `SELECT items.*, COUNT(item_upvotes.*)::int AS
upvote_count FROM items LEFT JOIN item_upvotes ON ... GROUP BY items.id ORDER
BY upvote_count DESC, items.created_at DESC`. If hot, promote to a stored
column with a trigger later.

### 7.8 `activity_events`

| column         | type                      | notes                                     |
|----------------|---------------------------|-------------------------------------------|
| id             | UUID PK                   |                                           |
| list_id        | UUID NOT NULL             | FK `lists.id` ON DELETE CASCADE           |
| actor_id       | UUID NOT NULL             | FK `users.id`                             |
| event_type     | activity_event_type enum  | see §4.7                                  |
| item_id        | UUID                      | FK `items.id` ON DELETE CASCADE; nullable |
| payload        | jsonb NOT NULL DEFAULT '{}'| event-specific details                   |
| created_at     | timestamptz NOT NULL      |                                           |

Indexes: `(list_id, created_at DESC)`, `(actor_id, created_at DESC)`.

Per-user "last read" timestamps live in `user_activity_reads (user_id,
list_id, last_read_at)`; unread count = events on the list newer than
`last_read_at`. Cross-list unread = sum over user's lists.

### 7.9 `metadata_cache`

| column         | type                      | notes                                     |
|----------------|---------------------------|-------------------------------------------|
| source         | text NOT NULL             | `tmdb \| books \| link_preview`           |
| source_id      | text NOT NULL             | TMDB id, Google Books id, or URL hash     |
| data           | jsonb NOT NULL            | normalized payload                        |
| fetched_at     | timestamptz NOT NULL      |                                           |
| PK             | (source, source_id)       |                                           |

TTL policy: TMDB/Books cached for 30 days; link previews for 7. Refetch on demand
when stale.

---

## 8. API surface

All routes under `/v1`. All authenticated routes require `Authorization: Bearer
<token>`. Shared types in `@workshop/shared`.

### Auth

- `POST /v1/auth/request` → `{ email }` → `{ ok: true }`
- `POST /v1/auth/verify` → `{ email, code }` → `{ sessionToken, user, needsDisplayName }`
- `GET  /v1/auth/me` → `{ user }`
- `PATCH /v1/users/me` → `{ displayName? }` → `{ user }`

### Lists

- `GET  /v1/lists` → `{ lists: List[] }` (lists the user owns or is a member of)
- `POST /v1/lists` → `{ type, name, emoji, color, description? }` → `{ list }`
- `GET  /v1/lists/:id` → `{ list, members, pendingInvites }`
- `PATCH /v1/lists/:id` → `{ name?, emoji?, color?, description? }` → `{ list }`
- `DELETE /v1/lists/:id` → `{ ok: true }` (owner only; hard delete cascades)

### Members / invites

- `POST   /v1/lists/:id/invites` → `{ email? }` → `{ invite }` (email null = share link)
- `POST   /v1/invites/:token/accept` → `{ list, member }` (auth required; auto-joins)
- `DELETE /v1/lists/:id/invites/:inviteId` → `{ ok: true }` (revoke)
- `DELETE /v1/lists/:id/members/:userId` → `{ ok: true }` (owner removes; or self-leave if `userId === me`)

### Items

- `GET    /v1/lists/:id/items?completed=<bool>` → `{ items: Item[] }`
- `POST   /v1/lists/:id/items` → `{ title, url?, note?, metadata? }` → `{ item }` (auto-upvotes)
- `GET    /v1/items/:id` → `{ item }`
- `PATCH  /v1/items/:id` → `{ title?, url?, note?, metadata? }` → `{ item }`
- `DELETE /v1/items/:id` → `{ ok: true }`
- `POST   /v1/items/:id/upvote` → `{ item }` (idempotent: creates upvote if absent)
- `DELETE /v1/items/:id/upvote` → `{ item }` (removes user's upvote)
- `POST   /v1/items/:id/complete` → `{ item }`
- `POST   /v1/items/:id/uncomplete` → `{ item }`

### Enrichment

- `GET /v1/search/media?type=movie|tv&q=<query>` → `{ results: MediaResult[] }`
- `GET /v1/search/books?q=<query>` → `{ results: BookResult[] }`
- `GET /v1/link-preview?url=<url>` → `{ preview: { title?, description?, image?, siteName? } }`

### Activity

- `GET  /v1/activity?cursor=<ts>&limit=50` → `{ events, nextCursor }`
- `POST /v1/activity/read` → `{ listIds? }` → `{ ok: true }` (marks all or specific lists read)

### Response envelope

Success: the resource directly (e.g., `{ item }`) or `{ ok: true }` for
no-content actions. Error: `{ error: string, code: string, details?: unknown }`
with a stable `code` enum (e.g., `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION`,
`FORBIDDEN`, `RATE_LIMITED`). Replaces the current inconsistent envelope (e.g.,
decrement returning two different shapes).

### Rate limiting (new)

Implemented as a tiny middleware backed by a Postgres rate-limit table keyed by
`(ip, route_family)`:

- `POST /auth/request` — 5/email/hour, 10/IP/hour.
- `POST /auth/verify`  — 10/code, rejected on the 11th.
- `POST /items`        — 60/user/minute.
- `POST /items/:id/upvote` + delete — 120/user/minute.
- Search endpoints — 60/user/minute.

---

## 9. Enrichment

### 9.1 TMDB (movies + TV)

- Backend proxies all search and detail lookups with our API key (stored in SSM).
- `GET /v1/search/media` → hits TMDB `/search/movie` or `/search/tv`; returns
  normalized rows: `{ id, title, year, posterUrl, runtimeMinutes?, overview }`.
- When an item is added with a TMDB match, we cache the full metadata in
  `metadata_cache`. The item's `metadata` JSONB is then:
  ```json
  { "source": "tmdb", "sourceId": "603692", "posterUrl": "...", "year": 2024,
    "runtimeMinutes": 166, "overview": "..." }
  ```

### 9.2 Google Books

- Backend proxies Google Books `volumes` endpoint. API key in SSM.
- Normalized result: `{ id, title, authors, year, coverUrl, pageCount?,
  description? }`.
- Item metadata JSONB:
  ```json
  { "source": "google_books", "sourceId": "...", "coverUrl": "...",
    "authors": ["..."], "year": 1999, "pageCount": 300 }
  ```

### 9.3 Link preview

- Backend-only scraper (`/v1/link-preview`). Fetches the URL with a short timeout
  (3s), 1MB max body, `User-Agent: WorkshopBot/1.0`. Parses OG + Twitter card
  meta tags. Returns normalized `{ title, description, image, siteName }`.
- Safety: allowlist schemes (`http`, `https` only); block private IP ranges
  (RFC1918, loopback, link-local) server-side to prevent SSRF. Block CRLF
  injection in redirect targets. Cap redirect chains at 3.
- Cached in `metadata_cache` keyed by a hash of the normalized URL.
- Item metadata JSONB for a free-form item with URL:
  ```json
  { "source": "link_preview", "sourceId": "<url-hash>", "image": "...",
    "siteName": "Google Maps" }
  ```

### 9.4 Type validation

Each list type has a Zod schema for the `items.metadata` JSONB:

- `movie` / `tv` → `{ source: "tmdb" | "manual", sourceId?: string, posterUrl?:
  string, year?: number, runtimeMinutes?: number, overview?: string }`.
- `book` → `{ source: "google_books" | "manual", sourceId?: string, coverUrl?:
  string, authors?: string[], year?: number, pageCount?: number }`.
- `date_idea` / `trip` → `{ source?: "link_preview" | "manual", sourceId?:
  string, image?: string, siteName?: string, lat?: number, lng?: number }`.

Applied on POST/PATCH of items at the API boundary.

---

## 10. iOS share extension

- Built as an Expo config plugin in `apps/workshop/plugins/share-extension/`
  that injects a share extension target into the iOS native project during
  prebuild.
- Handles `public.url` and `public.plain-text` share types.
- Extension UI: minimal native view showing the source URL + a "Open in
  Workshop" button. No in-extension list picker (keeps the extension tiny and
  avoids duplicating the app's React Native picker in Swift).
- Hand-off mechanism:
  - Extension writes the shared payload (URL + selected text, if any) to an
    app-group `UserDefaults` key.
  - Opens the main app via `workshop://share`.
  - Main app's root layout reads the URL/payload on launch or resume, clears
    the UserDefaults key, navigates to the list picker.
- **List picker screen**: modal stack. Shows user's lists + a "Create new list"
  row. Picking a list routes into the add-item confirm screen with the URL
  prefilled and the link preview pre-fetched.

---

## 11. Offline behavior

- Read-offline, write-online.
- TanStack Query's query cache is persisted via `persistQueryClient` to
  AsyncStorage (iOS) and `localStorage` (web).
- Cold start: rehydrate from persisted cache; screens render instantly with last-
  seen data, then revalidate.
- Writes (mutations) require network. If a mutation is invoked while offline,
  the UI reverts the optimistic update and surfaces a toast "You're offline.
  Retry?" with a retry button that re-invokes the mutation.
- No mutation queue / conflict resolution in v1. Real offline-first is deferred.

---

## 12. Realtime / collaboration

- **No WebSockets or server push in v1.**
- TanStack Query is configured with `refetchOnWindowFocus: true` and
  `refetchOnReconnect: true`.
- Pull-to-refresh on list screens.
- A subtle "new items since you opened this" pill appears at the top if a
  refetch lands with more items than we had (polish, not v1 blocker).

---

## 13. Testing

- **Unit**: Vitest for pure logic + Hono route handlers. Mock DB via Drizzle's
  test helper or a transactional wrapper rolling back after each test.
- **E2E**: Playwright, one happy-path test per major feature, targeting the
  web build against a local backend + local Postgres.
  - Sign in (magic-link with local stdout code).
  - Create a list (each of the 5 types).
  - Add an item (movie search, book search, free-form, URL paste).
  - Upvote / unvote.
  - Complete / uncomplete.
  - Share link → accept as second user.
  - Email invite → accept as second user (stub SES, read code from DB).
- **Typecheck + lint + knip** remain CI gates.
- Coverage target: unit ≥70% on the backend; E2E every listed flow green.

---

## 14. Migration strategy

1. **Data**: wipe. Drop `rec_items`, `magic_tokens`, `users` as a single
   migration (`drop_v1_schema`). No user-facing export or notification; v1 is
   personal / pre-launch.
2. **Schema**: single migration (`v2_schema`) creating the new tables (§7).
3. **Backend**: a new `/v1` route prefix. Old `/items`, `/auth`, etc. removed.
   No v0↔v1 compatibility layer.
4. **Client**: full rewrite of `apps/workshop/app/` and `apps/workshop/src/`.
   Keep the shared `storage.ts`/`storage.web.ts` pattern and the Expo config.
   Old components under `src/components/` deleted once the new UI ships.
5. **Shared types**: `@workshop/shared` rewritten to match new API.
6. **Deploy order**: ship backend first (new schema + new routes live, old
   routes gone, Lambda deployed). Clients talking to the old routes start
   failing immediately — acceptable given wipe. Ship the rewritten client via
   EAS build (share extension is a native change → forces a TestFlight build)
   + web deploy.
7. **Rollback**: git revert + redeploy. No data to preserve.

---

## 15. Build phasing

Each phase is a shippable unit with its own PR (or small stack of PRs).

### Phase 0 — Foundations (infra + schema + auth)

- New Drizzle migrations: wipe old, create new schema.
- Rate-limit table + middleware.
- `users.display_name` end-to-end: migration, API, client capture flow.
- Updated auth endpoints under `/v1`.
- Terraform: SSM params for `TMDB_API_KEY`, `GOOGLE_BOOKS_API_KEY`.
- Primitives library skeleton + theme tokens.

### Phase 1 — Core list CRUD (single user)

- `lists` / `list_members` / `items` / `item_upvotes` endpoints.
- Home screen (list of lists, empty state, create FAB).
- Create-list flow.
- List detail (rich cards, upvote pill, completed section, client-side search).
- Item detail.
- Add-item flow for date-idea/trip type (free-form + link preview).
- Edit / delete flows.
- TanStack Query wired with optimistic updates for upvote, complete, add.

### Phase 2 — Enrichment

- `/v1/search/media`, `/v1/search/books`, `/v1/link-preview` + cache table.
- Live search pickers in the add flow for movie/tv/book lists.
- Auto link-preview for date-idea/trip.

### Phase 3 — Social

- `list_invites` endpoints (create, accept, revoke).
- Email invite template (SES).
- Member management UI in list settings.
- `activity_events` + `user_activity_reads`.
- Cross-list notifications view + unread badge.

### Phase 4 — iOS share extension

- Expo config plugin (share extension target).
- App-group UserDefaults handoff.
- Deep-link handler for `workshop://share`.
- Share-sourced list picker.
- First TestFlight build triggered by expo-fingerprint.

### Phase 5 — Polish

- Offline cache persistence (TanStack Query `persistQueryClient`).
- Desktop two-pane responsive layout.
- Playwright E2E per flow.
- Light-mode tokens (ship second theme).
- Haptics + micro-animations.

---

## 16. Open questions / assumptions

Assumptions I'm making unless you say otherwise:

1. **Secondary sort** within a list is `created_at DESC` on upvote-count ties.
2. **Trip list items** = individual places/activities within a single trip (not
   each item = a whole trip). Trip-level dates, if needed, become list metadata
   in a later phase.
3. **Rate-limit thresholds** per §8 are approximate; tune after the first week
   of real use.
4. **List deletion** is hard delete with a confirmation dialog. No soft-delete
   / recovery window.
5. **Activity retention** is unbounded in v1; paginate at 50/page. Add
   retention policy only if storage becomes a concern.
6. **Fonts** are system-native. No custom fonts.
7. **Avatars** are initials-only for v1. Real image uploads (S3 + presigned
   PUT) are a v1.1 scope.
8. **No push notifications** in v1. Revisit if the in-app feed proves
   insufficient.
9. **Web hosting story** — the web build is part of the Expo output; v1 still
   needs a decision on where it's served from (Cloudflare Pages, S3 +
   CloudFront, Vercel, etc.). Flag for the infra PR in Phase 0.
10. **Single-emoji validation**: we store whatever the user types; we trim to
    the first grapheme server-side. Emoji picker UX in Phase 1 uses the system
    keyboard emoji panel on iOS / a minimal picker on web.
11. **Color palette** — a finite named set (e.g., `indigo`, `teal`, `amber`,
    `rose`, `slate`, `lime`, `violet`, `sky`). Exact hex values belong in the
    theme file; exact set finalized in Phase 0.
12. **Backend response envelope change** is technically breaking for any code
    still reading old shapes. Since old routes are being removed wholesale,
    this is not backwards-compat work; it's a clean cutover.

Please flag any of these you want to pin down before Phase 0 starts.
