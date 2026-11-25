// Challenge links (`/c/:token`) — the pure parts: the text a challenger sends,
// and how much of the day is left. The screen is `screens/ChallengeLanding.tsx`;
// the mint lives in `hooks/useChallengeFriend.ts`.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** "I got 937 on today's MapTap. Beat me: https://highscore.live/c/<token>" */
export function challengeShareText(input: {
  display: string;
  gameTitle: string;
  url: string;
}): string {
  return `I got ${input.display} on today's ${input.gameTitle}. Beat me: ${input.url}`;
}

/** "Ends in 5h" / "Ends in 40 min" / "Ends in a minute" / null once over. */
export function challengeTimeLeft(expiresAt: string, now: number = Date.now()): string | null {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return null;
  const left = end - now;
  if (left <= 0) return null;
  if (left >= HOUR_MS) return `Ends in ${Math.floor(left / HOUR_MS)}h`;
  const minutes = Math.floor(left / MINUTE_MS);
  return minutes >= 2 ? `Ends in ${minutes} min` : "Ends in a minute";
}
