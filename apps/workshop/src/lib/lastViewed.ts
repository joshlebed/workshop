import { getItem, removeItem, setItem } from "./storage";

const ACTIVITY_LAST_VIEWED_KEY = "workshop.activity.last-viewed-at";

/**
 * The bell badge derives an unread count by comparing each `ActivityEvent.createdAt`
 * against this client-side timestamp. Tapping the bell (or focusing the activity
 * screen) bumps it forward and also fires `POST /v1/activity/read` so other
 * sessions of the same user eventually agree.
 *
 * Server-side `lastReadAt` per list isn't surfaced on `GET /v1/lists` yet — when
 * it lands, `getActivityLastViewedAt` becomes a fallback for first-paint before
 * the lists query completes.
 */
export async function getActivityLastViewedAt(): Promise<string | null> {
  return getItem(ACTIVITY_LAST_VIEWED_KEY);
}

export async function setActivityLastViewedAt(iso: string): Promise<void> {
  await setItem(ACTIVITY_LAST_VIEWED_KEY, iso);
}

export async function clearActivityLastViewedAt(): Promise<void> {
  await removeItem(ACTIVITY_LAST_VIEWED_KEY);
}
