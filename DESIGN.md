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
OKLCH and checked for WCAG AA: `text.muted` clears 4.5:1 on both canvas and
surface in both modes.

## Color palette (OKLCH-equivalent hex)

Dark:

- `bg.canvas` `#0E0C0B` · `bg.surface` `#191715` · `bg.elevated` `#24221F`
- `text.primary` `#F2F0ED` · `text.secondary` `#A7A29E` · `text.muted` `#86817C`
- `border.subtle` `#2D2926` · `border.default` `#3C3835` · `border.strong` `#55504C`

Light:

- `bg.canvas` `#FEFCFA` · `bg.surface` `#F7F4F2` · `bg.elevated` `#EFECE9`
- `text.primary` `#1F1B17` · `text.secondary` `#554F49` · `text.muted` `#726C66`
- `border.subtle` `#E3DFDA` · `border.default` `#D4CEC9` · `border.strong` `#AFA8A1`

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
look).

## Spacing & radius

Spacing: 4 · 8 · 12 · 16 · 24 · 32 (plus 2 and 6 for optical nudges). Radius: 6 · 10 ·
14 · pill. Touch targets: 44.

## Components

Every Workshop screen is built from the primitives in `packages/ui` (`@workshop/ui`). Reach
for these before writing a `Pressable` or a `TextInput` by hand; if one is missing a case,
extend it rather than copying it into a screen.

| Primitive                         | Use it for                         | API in one line                                                                                                                                                           |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScreenHeader`                    | Every screen header                | `leading="back" \| "close" \| "none"`, `onLeadingPress`, `title`, `eyebrow`, `titleAccessory`, `trailing`, `center`                                                       |
| `Icon`                            | Every control glyph                | `name` (back, chevron, chevron-down, close, more, check, plus, refresh, drag, external, search, share, settings, bell, pin, hide, trash, copy), `size`, `tone` or `color` |
| `IconButton`                      | Icon-only actions                  | 44×44; `icon`, `iconTone`, `accessibilityLabel`, `busy`, `toggled` (`aria-pressed`)                                                                                       |
| `Button`                          | Text actions                       | `variant="primary" \| "secondary" \| "ghost" \| "danger"`, `size`, `loading`, `leftIcon`                                                                                  |
| `ListRow`                         | Every row that opens something     | `[leading] title / subtitle [trailing]`, `chevron`, `onPress`, `onLongPress`, `selected`, `pressableProps`                                                                |
| `EmojiBadge`                      | A list's identity mark             | `emoji`, `color` (list hue, 20% fill), `size={24 \| 44 \| 72}`, `imageUrl`, `shape`                                                                                       |
| `TextField`                       | Every text input                   | `label` (wired), `hint`, `error`, `multiline`, `variant="search"` + `onClear`, `trailing`; font never below 16                                                            |
| `ActionSheet`                     | Menus of actions                   | `items=[{label, icon?, tone?: "default" \| "danger", onPress}]`, `title` or `header`; runs the choice after the sheet closes                                              |
| `confirm()` + `ConfirmDialogHost` | Irreversible actions               | `confirm({title, message, confirmLabel, destructive})` → `Promise<boolean>`; in-app dialog on web, system alert on native                                                 |
| `Sheet`                           | Anything else that slides up       | ≤85% of the screen, scrolls inside, no drag handle (no pan to dismiss)                                                                                                    |
| `Skeleton`                        | First load only                    | `Skeleton.Rows count`, `Skeleton.Row` (ListRow metrics), `Skeleton.Block`; still under reduced motion                                                                     |
| `Fab`                             | The one primary action of a screen | bottom-right 56pt accent disc; lifts toasts above itself                                                                                                                  |
| `Switch`                          | On/off settings                    | labelled row, `role="switch"`, `aria-checked`                                                                                                                             |
| `RadioRow`                        | Single choice                      | `role="radio"` row; wrap a set in `role="radiogroup"`                                                                                                                     |
| `SectionHeader`                   | Labels above groups                | uppercase tracked `eyebrow` text + optional trailing                                                                                                                      |
| `Badge`                           | Counts, one-word statuses          | `label`, `tone="accent" \| "neutral" \| "danger"`, `ringColor`                                                                                                            |
| `Chip`                            | Tags and filters                   | 32pt pill in a 44pt target, `aria-pressed`                                                                                                                                |
| `Toast` (`useToast`)              | Feedback after an action           | enter/exit on the motion tokens, `role="status"` (alert for danger); Undo is a quiet accent text action; `key` replaces an earlier toast of the same kind                 |

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

## Anti-patterns to refuse

- Side-stripe borders. Gradient text. Decorative glassmorphism. Hero-metric
  templates. Identical card grids. Em dashes in copy.
