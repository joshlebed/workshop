// The URL is the sheet stack.
//
// HighScore's navigation model (see apps/highscore/UX-EXPLORATION.md): the day
// timeline is the only screen. Everything else — a game board, the friends
// list, a friend profile, your account — opens as a sheet *over* it. Those
// sheets still own real routes (`/games/:id`, `/friends`, `/friends/:userId`,
// `/profile`) so deep links, the browser back button and iOS's back gesture
// keep working; this module is the single place that maps a pathname onto the
// sheet that should be on top.
//
// Routes deliberately NOT in here are full screens with no timeline behind
// them: `/sign-in`, `/onboarding/*`, `/share/*`, `/g/:token`,
// `/friends/accept/:token`, `/support`, `/privacy`.

export type SheetEntry =
  | { key: string; kind: "game"; gameId: string }
  | { key: string; kind: "friends" }
  | { key: string; kind: "friend"; userId: string; via: string | null }
  | { key: string; kind: "account" };

/** Human title for the sheet chrome. Game titles are resolved by the sheet itself. */
export const SHEET_FALLBACK_TITLE: Record<SheetEntry["kind"], string> = {
  game: "Game",
  friends: "Friends",
  friend: "Profile",
  account: "Account",
};

function segmentsOf(pathname: string): string[] {
  return pathname.split("/").filter((s) => s.length > 0);
}

/**
 * Which sheet (if any) the current pathname puts on top. `via` is the play-link
 * vouch token that lets a friend profile render for a not-yet-friend.
 */
export function parseSheetRoute(pathname: string, via: string | null = null): SheetEntry | null {
  const segments = segmentsOf(pathname);
  const [first, second] = segments;

  if (first === "games" && second) {
    return { key: `game:${second}`, kind: "game", gameId: decodeURIComponent(second) };
  }
  if (first === "friends") {
    if (!second) return { key: "friends", kind: "friends" };
    // `/friends/accept/:token` is a full screen, not a sheet.
    if (second === "accept") return null;
    return {
      key: `friend:${second}`,
      kind: "friend",
      userId: decodeURIComponent(second),
      via,
    };
  }
  if (first === "profile") return { key: "account", kind: "account" };
  return null;
}
