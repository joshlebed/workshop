import { HIGHSCORE_APP_STORE_URL } from "@workshop/shared/constants";

// Apple's official "Download on the App Store" badge (black, en-US), served
// from /app-store-badge.svg. Apple's marketing guidelines require the badge
// to be used unmodified, at a minimum height of 40px, with clear space of at
// least a quarter of its height around it — the callers' padding provides that.
// A real <a href> (not a Pressable) so it is crawlable and middle-clickable.
const BADGE_HEIGHT = 54;
const BADGE_WIDTH = Math.round(BADGE_HEIGHT * (119.66407 / 40));

export function AppStoreBadge() {
  return (
    <a
      href={HIGHSCORE_APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Download HighScore on the App Store"
      data-testid="sign-in-app-store-link"
      style={{ display: "inline-block", lineHeight: 0 }}
    >
      <img
        src="/app-store-badge.svg"
        alt="Download on the App Store"
        width={BADGE_WIDTH}
        height={BADGE_HEIGHT}
        style={{ display: "block" }}
      />
    </a>
  );
}
