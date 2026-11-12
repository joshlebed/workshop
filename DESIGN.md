# Design

## Theme

Dark. A couple thumbing through a shared list at night on the couch is the scene
that forced the answer. Light mode is pinned off for now (usability pass, 2026-11-11):
the light palette below is kept for when it returns as its own project.

## Color strategy

**Restrained.** Warm-tinted near-black canvas, one warm amber accent at ≤10% of
any surface. Per-list color (the seven `tokens.list.*` hues) identifies a list
inside its avatar/badge only; the rest of the chrome stays neutral. Never use
`#000` or `#fff`.

Every neutral is tinted warm (OKLCH hue ~66, the amber accent's own hue) at very
low chroma, so canvas, surface, and elevated belong to one family and step up in
lightness rather than shifting hue. Canvas is always the darkest layer. (A prior
navy `#081325` canvas under neutral surfaces read as the "dark-glow AI app"
look the brand explicitly avoids; the warm ramp replaced it.) Values derived in
OKLCH and checked for WCAG AA (UX pass 5.5): `text.muted` clears 4.5:1 on
canvas, surface and elevated; `border.control` clears 3:1 on all three. The
other borders are dividers and quiet card edges, decorative and exempt; anything
you operate (TextField box, Chip outline, secondary Button, checkbox and radio
rings, the off Switch track) takes `border.control`. On the accent tint
(`accent.muted`, a selected chip or an on Switch) a description uses
`text.secondary`, since `muted` drops to ~4.2:1 there.

## Color palette (OKLCH-equivalent hex)

Dark:

- `bg.canvas` `#0E0C0B` · `bg.surface` `#191715` · `bg.elevated` `#24221F`
- `text.primary` `#F2F0ED` · `text.secondary` `#A7A29E` · `text.muted` `#908B87`
- `border.subtle` `#2D2926` · `border.default` `#3C3835` · `border.strong` `#55504C`
- `border.control` `#726E6A` (OKLCH ~0.54 0.008 66: 3.9 / 3.5 / 3.1:1 on canvas / surface / elevated)

Light:

- `bg.canvas` `#FEFCFA` · `bg.surface` `#F7F4F2` · `bg.elevated` `#EFECE9`
- `text.primary` `#1F1B17` · `text.secondary` `#554F49` · `text.muted` `#726C66`
- `border.subtle` `#E3DFDA` · `border.default` `#D4CEC9` · `border.strong` `#AFA8A1`
- `border.control` `#847F7B`

Shared:

- accent `#F5A524` (hover `#E89611`, muted `#F5A52422`), `text.onAccent` `#0E0C0B`
- status: success `#3DD68C`, warning `#F5A524`, danger `#F05252`
- list hues: sunset, ocean, forest, grape, rose, sand, slate

## Typography

System font stack (SF on iOS, system-ui on web). Size scale (`font.size`):
12/13/16/18/22/28/34. Weights: 400/500/600/700. Hierarchy through scale + weight
contrast. Each `Text` variant carries its own line-height so vertical rhythm is
correct by default: display 34/700 (40, -0.6), title 28/600 (line-height 34,
tracking -0.4), heading 18/600 (24, -0.2), body 16/400 (22), label 13/500 (18),
caption 12/400 (16), eyebrow 12/600 uppercase (16, +0.8, muted by default). Large
titles take negative tracking; RN's auto line-height runs tight on heavy weights, so
lean on the variant's. `display` and `title` announce as level-1 headings and
`heading` as level 2 (`headerRole={false}` opts out for text that only borrows the
look). The numbers live in `tokens.font`: `size`, the matching `lineHeight` per step
(16/18/22/24/28/34/40) and `tracking` (display/title/heading/eyebrow). Prefer a variant;
a hand-set `fontSize` (an emoji glyph, an input) takes the same step's `lineHeight`. A
nested `<Text>` inside another starts from `body` again, so give it the parent's variant.

## Spacing & radius

Spacing: 4 · 8 · 12 · 16 · 24 · 32 (plus 2 and 6 for optical nudges). Radius: 6 · 10 ·
14 · pill. Touch targets: 44.

## Layout

`layout` in `@workshop/ui` (`packages/ui/src/Layout.tsx`) holds the page constants.

- **One gutter: 16** (`layout.gutter`) on every screen. It is also where a `ListRow`'s
  content starts (4 margin + 12 padding), so a padded block's text lines up with a row's.
- **One section rhythm**: a `SectionHeader` sits 24 below the content before it
  (`layout.sectionTop`) and 4 above its first row (`layout.sectionBottom`). The primitive
  owns this (and the gutter): don't pad it from outside. `first` drops the 24 to 8 for the
  header directly under the screen header or toolbar; `inset={false}` inside a block already
  padded by the gutter.
- **The page scrolls, not a box inside it (web).** `Screen` is the full width of its pane;
  each screen's scroll view spans it, so the scrollbar sits at the window edge and the wheel
  works anywhere. Content is held to the 560 reading column by `screenColumnStyle` (on a
  scroll view's `contentContainerStyle`) or `ScreenColumn` (a block that doesn't scroll);
  `ScreenHeader` applies it to itself and stays put above the scroll (the sticky header).
- **Pin only a compact bar.** Anything taller than the 56pt bar scrolls with the content. On
  list detail the title block, search field and tag bar sit at the top of the scroll (the
  list's `ItemList` `header` prop); the bar keeps back, share and settings, fades the list name
  in once the big title has gone (`fast`, at once under reduced motion), and once the search
  and tags have gone too it offers a search button, or a chip naming the active filter with
  its own clear. `/` and ⌘K jump back to the field. Scrolled, only the 56pt bar stays pinned. Home already works this way (its
  search is the list header).
  Floating chrome goes in `Screen`'s `overlay` prop so a FAB stays at the column's corner,
  not the window's. Native ignores all of this.
- **Desktop two-pane (web, 900px and up)**: the lists sit in a 360 sidebar on the left and
  the `(lists)` stack (a list, its items, add, settings, the create flow) renders in the pane
  on the right, centred in the same reading column. The sidebar is chrome beside the stack,
  not a route, so URLs, back/forward, deep links and reload are the stack's own. The open
  list's row is `aria-current="page"`; picking another list replaces what the pane shows
  (home stays beneath). With no list open the pane says "Open a list". A list in the pane has
  no back button. Someone with no lists gets the phone layout (the empty home teaches better
  full width), and below 900px nothing changes. Sheets present as a centred dialog from
  720px. Activity, sign-in and the share picker live outside the stack and stay single
  column.
- **Keyboard (web)**: `/` or ⌘K search, `N` new list or add, Escape closes (sheets, add,
  paste many, the create flow, list settings) or clears the search, ⌘Enter adds all / creates
  the list, ⌘Z Undo while an Undo toast shows, ⌘/ Activity, `?` the shortcuts sheet (also Settings → Keyboard shortcuts, shown
  only with a fine pointer). One catalog (`src/lib/shortcuts/catalog.ts`) feeds the handlers
  and the sheet. Keys never fire while typing in a field, while a sheet or dialog is open, or
  on a screen that isn't on top (`useShortcuts(handlers, isFocused)`).
- **Toasts belong to the screen that raised them.** Opening another screen on top (a push,
  a modal, a replace) dismisses them; going back keeps them, so "Deleted · Undo" raised in
  item detail is still there on the list. A toast raised within 600ms of the navigation was
  raised by it ("Added to Movies" after the share picker lands on the list) and stays.
- **Hover**: every pressable has a hover state and a pointer cursor; icon-only buttons show
  their name as a tooltip.

## Components

Every Workshop screen is built from the primitives in `packages/ui` (`@workshop/ui`). Reach
for these before writing a `Pressable` or a `TextInput` by hand; if one is missing a case,
extend it rather than copying it into a screen.

| Primitive                         | Use it for                         | API in one line                                                                                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScreenHeader`                    | Every screen header                | `leading="back" \| "close" \| "none"`, `onLeadingPress`, `title`, `eyebrow`, `titleAccessory`, `trailing`, `center`                                                                                                                                              |
| `Icon`                            | Every control glyph                | `name` (back, chevron, chevron-down, close, more, check, plus, refresh, drag, external, search, share, settings, bell, pin, hide, trash, copy), `size`, `tone` or `color`                                                                                        |
| `IconButton`                      | Icon-only actions                  | 44×44; `icon`, `iconTone`, `accessibilityLabel`, `busy`, `toggled` (`aria-pressed`)                                                                                                                                                                              |
| `Button`                          | Text actions                       | `variant="primary" \| "secondary" \| "ghost" \| "danger"`, `size`, `loading`, `leftIcon`                                                                                                                                                                         |
| `ListRow`                         | Every row that opens something     | `[leading] title / subtitle [trailing]`, `chevron`, `onPress`, `onLongPress`, `selected`, `pressableProps`                                                                                                                                                       |
| `EmojiBadge`                      | A list's identity mark             | `emoji`, `color` (list hue, 20% fill), `size={24 \| 44 \| 72}`, `imageUrl`, `shape`                                                                                                                                                                              |
| `TextField`                       | Every text input                   | `label` (wired), `hint`, `error`, `multiline`, `variant="search"` + `onClear`, `trailing`; font never below 16                                                                                                                                                   |
| `ActionSheet`                     | Menus of actions                   | `items=[{label, icon?, tone?: "default" \| "danger", onPress}]`, `title` or `header`; runs the choice after the sheet closes                                                                                                                                     |
| `confirm()` + `ConfirmDialogHost` | Irreversible actions               | `confirm({title, message, confirmLabel, destructive})` → `Promise<boolean>`; in-app dialog on web, system alert on native                                                                                                                                        |
| `Sheet`                           | Anything else that slides up       | ≤85% of the screen, scrolls inside, no drag handle (no pan to dismiss)                                                                                                                                                                                           |
| `Skeleton`                        | First load only                    | `Skeleton.Rows count`, `Skeleton.Row` (ListRow metrics), `Skeleton.Block`; still under reduced motion                                                                                                                                                            |
| `Fab`                             | The one primary action of a screen | bottom-right 56pt accent disc; lifts toasts above itself                                                                                                                                                                                                         |
| `Switch`                          | On/off settings                    | labelled row, `role="switch"`, `aria-checked`                                                                                                                                                                                                                    |
| `RadioRow`                        | Single choice                      | `role="radio"` row; wrap a set in `role="radiogroup"`                                                                                                                                                                                                            |
| `SectionHeader`                   | Labels above groups                | uppercase tracked `eyebrow` text + optional trailing; owns the gutter and the 24/4 rhythm (`first`, `inset={false}`)                                                                                                                                             |
| `Badge`                           | Counts, one-word statuses          | `label`, `tone="accent" \| "neutral" \| "danger"`, `ringColor`                                                                                                                                                                                                   |
| `Chip`                            | Tags and filters                   | 32pt pill in a 44pt target, `aria-pressed`                                                                                                                                                                                                                       |
| `Toast` (`useToast`)              | Feedback after an action           | enter/exit on the motion tokens; read out by a persistent live region (alert for danger) on web and `announceForAccessibility` on native; pointer or focus holds the timer; Undo is a quiet accent text action; `key` replaces an earlier toast of the same kind |

Rules the primitives encode:

- **Header.** Destinations are pushes with back on the left. Flows that create or edit
  something are modals with close on the left and the commit action in `trailing`. One top
  padding, one title style (`heading`, left aligned).
- **Row.** Leading badge 44 (24 inline, 72 for a hero), title 16/500, one quiet 12px subtitle,
  min height 56; the whole row is the target. Hover and pressed are translucent steps of
  `text.primary` (`interaction.hover` / `interaction.pressed`), so they read on any surface.
- **Targets and inputs.** Every target is at least 44×44 on every platform (web ignores
  `hitSlop`, so the box itself is 44). Every input is at least 16px.
- **Focus.** One focus style: a 2px ring in the accent at low emphasis
  (`interaction.focus`), offset 2px, keyboard only (`:focus-visible`, installed by
  `installWebFocusRing()` in Workshop's root layout). Inputs show it as their border instead.
  Dialogs (`Sheet`, `ActionSheet`, `ConfirmDialog`) take focus when they open (the first
  control; Cancel in a destructive confirm), keep Tab inside, close on Escape and hand focus
  back to the opener. After a navigation on web, focus moves to the new screen's level-1
  heading (`useFocusScreenHeading`, no ring), unless the screen focused a field itself.
- **Outline.** One level-1 heading per screen: `ScreenHeader`'s title (or the in-body
  `title`), `SectionHeader`s are level 2, and text that only borrows a heading's look passes
  `headerRole={false}`. The desktop sidebar's "Lists" is level 2 (`titleLevel={2}`).
- **Names.** A row is named by its own visible text (no `accessibilityLabel` that rewords
  it, WCAG 2.5.3); extra state goes in a hint or, on web, `aria-describedby`. Icon-only
  controls always carry a label.
- **Danger** is always `status.danger`, never the accent, in menus, buttons and dialogs.
- **List rows** (Workshop list detail): a 22pt circle checkbox leads every open row when the
  list has completion on; a ranked row's numeral sits inline before its title, so the checkbox
  column never moves. Placeholder glyphs are dimmed so real artwork leads. Lifted rows scale
  1.02 on the surface step with a neutral shadow.
- **Card.** Used sparingly; never nested. Default to no container.
- **Settings screens** (Workshop `/settings`, list settings) are `SectionHeader` groups of
  `ListRow`s, not button stacks. Edits autosave with a quiet "Saving… / Saved" in the header
  trailing slot; the destructive action sits alone at the bottom under a plain heading
  ("Delete list"), never "Danger zone".
- **Home row** (Workshop): badge, name, one second line (count · last activity · age), a small
  member avatar stack and an unread count `Badge` as trailing. The pin `Icon` marks pinned rows
  under a "Pinned" `SectionHeader`.
- **FAB.** Elevation is a **neutral** drop shadow (`rgba(0,0,0,…)`), never a colored halo: the
  accent fill carries the warmth, a glow would read as the "AI app" aesthetic the brand avoids.

Tokens beyond color: spacing adds `space.xxs` (2) and `space.xsm` (6) for optical nudges;
`tokens.hit` is 44; translucent colors come from `alpha(color, level)`, never from
concatenating a hex suffix.

## Motion

Three durations and one curve, in `tokens.motion`: `fast` 150ms (exits, toggles, dialogs),
`base` 220ms (toasts, sheet exit), `slow` 320ms (sheet entrance, empty states), all on
`easeOut` (cubic-bezier 0.16, 1, 0.3, 1; `Easing.bezier(...tokens.motion.easeOut)`). No bounce.
No animated layout properties. Respect reduced motion: drop translation, keep or skip the fade.

Everything goes through `packages/ui/src/motion.ts` (exported from `@workshop/ui`):
`timing(speed)` for `withTiming`, `easeOut` / `easeOutCss` for the curve, and the layout presets
`motionPresets.enter` / `exit` / `move` / `reveal`. Don't write a duration or an easing by hand.

**Reduced motion** (iOS Reduce Motion, web `prefers-reduced-motion`, read by Reanimated's
`useReducedMotion`): movement goes, fades stay. `timing()` and the fade presets keep playing
(`ReduceMotion.Never`); `motionPresets.move` is skipped (`ReduceMotion.System`); anything that
translates, scales or rotates by hand checks `useReducedMotion()` and drops it;
`useMotionDuration(speed)` returns 0 for movement driven outside Reanimated.

| Surface                                                                     | Motion                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List rows (complete, reopen, delete, Undo, reorder by menu, filter, search) | The row leaving fades out (`exit`, `fast`); neighbours slide to close or open the gap (`move`, `base`); a row joining a section waits `fast` for the slide, then fades in (`enter`, `fast`). Rows already there when the list opens just appear (`LayoutAnimationConfig skipEntering`). Web and native's Done block; native open rows move without a slide (see below). |
| Drag to reorder                                                             | Web: neighbours shuffle on `base` + the curve (dnd-kit `transition`), the lifted row drops into place on the same; none under reduced motion. Native: the library's drop slide runs on `base` (`animationDuration`).                                                                                                                                                    |
| Done section                                                                | Rows fade in / out as above; the chevron turns 180° (`fast`; snaps under reduced motion).                                                                                                                                                                                                                                                                               |
| New-row highlight (after add, share save, sync)                             | The wash is on at once and fades out at `slow` when it ends (opacity, so it plays under reduced motion).                                                                                                                                                                                                                                                                |
| Skeleton → content                                                          | `Reveal` fades the content in over the gap (`reveal`, `fast`) on home, list detail (route and rows), activity and list settings; content painted from cache never fades.                                                                                                                                                                                                |
| Toasts                                                                      | Rise 12px and fade in (`base`), fade out (`fast`); a stacked toast slides into the gap (`move`). Reduced motion: fade only.                                                                                                                                                                                                                                             |
| Sheets                                                                      | Slide up from the bottom (`slow`), back down (`base`); the backdrop fades with it. Web ≥720px: a centred dialog that rises 12px and fades. Reduced motion: fade in place.                                                                                                                                                                                               |
| Confirm dialog                                                              | Fades and scales from 0.97 (`fast`); fade only under reduced motion.                                                                                                                                                                                                                                                                                                    |
| Switch                                                                      | The knob slides (`fast`); snaps under reduced motion.                                                                                                                                                                                                                                                                                                                   |
| Empty states (`motion`)                                                     | Fade and rise 8px (`slow`); appear at once under reduced motion.                                                                                                                                                                                                                                                                                                        |
| Button loading                                                              | The label stays in place, invisible, under a centred spinner, so the button never changes width.                                                                                                                                                                                                                                                                        |

Kept outside the tokens on purpose: the skeleton pulse (900ms `inOut(quad)` loop, a
there-and-back breathe that a one-way ease-out can't draw; holds still under reduced motion).
Web pull-to-refresh's settle and snap-back follow the finger, then ease on the tokens. Native open
rows inside the reorderable list don't slide when a neighbour leaves: the library's
`itemLayoutAnimation` would replay the move after a drop, and it can't be checked without a
device.

## Haptics

Through `haptics` from `@workshop/ui` only (no `expo-haptics` import in Workshop). Fire on the
tap, optimistically, never on the server's answer (a mutation's `onMutate`, or before the
request). Web is a no-op.

| Kind        | When                                              | Where                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selection` | A toggle, a picker choice, a chip, a reorder step | `Switch`, `RadioRow` (on a change), `Chip` (every interactive chip: tag filter, saved views, activity filters, `TagEditor` suggestions) and `TagEditor`'s typed tag; emoji / color pickers (create, list settings); Done expand / collapse; pin / mute a list; native drag lift and each slot crossed (`onIndexChange`); drop; Move up / down; Rank at top / bottom, Remove from ranking, and their Undo |
| `light`     | A tap that commits                                | Complete / reopen (checkbox, row menu, item detail) and its Undo; add item (quick add, search result, details) and the add surface's Undo; delete Undo; hide / unhide a list; cover photo set / removed; Letterboxd connect, suggest, accept; display name saved                                                                                                                                         |
| `success`   | Something new exists, or you're in                | Create list (template tap, Customize, playlist import), duplicate list, join a list (share link, legacy invite), share-picker save (one tap or via the add surface), bulk add, save a view                                                                                                                                                                                                               |
| `warning`   | A destructive action, as it's confirmed           | Delete item (act-then-undo, no dialog), and on confirming: Delete list, Leave list, Remove member, Make owner, Reset link, Delete account, Delete view, a feature change the server warns about                                                                                                                                                                                                          |

`medium` is HighScore's; Workshop doesn't use it. Navigation, opening a sheet, copying and
sharing get none.

## Anti-patterns to refuse

- Side-stripe borders. Gradient text. Decorative glassmorphism. Hero-metric
  templates. Identical card grids. Em dashes in copy.
