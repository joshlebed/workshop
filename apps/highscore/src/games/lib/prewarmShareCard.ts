/**
 * Pre-warm a share link's Open Graph card at the edge.
 *
 * The card is rendered on demand by a Pages Function (~0.7s cold, most of it
 * PNG-encoding a 1200x630 raster) and cached per colo for a day. iMessage
 * builds the link preview on the *sender's* device — the same network the app
 * is on — so fetching the card right after the link is minted, before the
 * user has even pasted, turns the crawler's fetch into a cache hit.
 * Fire-and-forget: a failure just means the crawler renders it cold.
 */
export function shareCardUrl(linkUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(linkUrl);
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/g\/([^/]+)$/);
  if (!match) return null;
  return new URL(`/og/g/${match[1]}.png`, url.origin).toString();
}

export function prewarmGameShareCard(linkUrl: string): void {
  const cardUrl = shareCardUrl(linkUrl);
  if (!cardUrl) return;
  void fetch(cardUrl, { method: "GET" }).catch(() => undefined);
}
