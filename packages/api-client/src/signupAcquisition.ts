// Client half of signup attribution (backend: apps/backend/src/lib/signupAttribution.ts).
//
// Two sources of "how did this visitor find the app":
//   1. The invite / play-link token the app already stashes before bouncing a
//      signed-out visitor through sign-in (each app passes its own keys).
//   2. Web only: the very first page load's cross-site referrer, pathname and
//      utm_* params — stashed once (first touch) by `stashSignupLanding()`,
//      which each app's root layout calls at module load, before any redirect.
// `collectSignupAcquisition()` gathers both into the `acquisition` field of
// the Apple/Google sign-in body. Everything is best-effort: storage failures
// produce an empty object, never a failed sign-in.

import type { SignupAcquisition } from "@workshop/shared";
import { getItem, removeItem, setItem } from "./storage";

const SIGNUP_LANDING_KEY = "workshop.signup-landing";

type StoredLanding = Pick<SignupAcquisition, "referrer" | "landingPath" | "utm">;

/**
 * Pure: what to remember about a landing. Same-site referrers are dropped
 * (they're our own navigation, not acquisition). Returns `{}` when nothing
 * parses — still stored, so a later in-app visit can't overwrite the first.
 */
export function landingFromLocation(href: string, referrer: string): StoredLanding {
  const landing: StoredLanding = {};
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return landing;
  }
  landing.landingPath = url.pathname;
  if (referrer) {
    try {
      const ref = new URL(referrer);
      if (ref.host !== url.host) landing.referrer = `${ref.protocol}//${ref.host}${ref.pathname}`;
    } catch {
      // Unparsable referrer — nothing to keep.
    }
  }
  const utm: NonNullable<StoredLanding["utm"]> = {};
  for (const key of ["source", "medium", "campaign"] as const) {
    const value = url.searchParams.get(`utm_${key}`)?.trim();
    if (value) utm[key] = value.slice(0, 128);
  }
  if (Object.keys(utm).length > 0) landing.utm = utm;
  return landing;
}

function parseLanding(raw: string | null): StoredLanding {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return {};
    const v = value as Record<string, unknown>;
    const out: StoredLanding = {};
    if (typeof v.referrer === "string") out.referrer = v.referrer;
    if (typeof v.landingPath === "string") out.landingPath = v.landingPath;
    if (v.utm && typeof v.utm === "object") {
      const utm = v.utm as Record<string, unknown>;
      const picked: NonNullable<StoredLanding["utm"]> = {};
      for (const key of ["source", "medium", "campaign"] as const) {
        if (typeof utm[key] === "string") picked[key] = utm[key];
      }
      if (Object.keys(picked).length > 0) out.utm = picked;
    }
    return out;
  } catch {
    return {};
  }
}

/** Web-only, first-touch: remember this page load's referrer / landing / utm. */
export async function stashSignupLanding(): Promise<void> {
  if (typeof document === "undefined" || typeof window === "undefined" || !window.location) return;
  try {
    if (await getItem(SIGNUP_LANDING_KEY)) return;
    const landing = landingFromLocation(window.location.href, document.referrer ?? "");
    await setItem(SIGNUP_LANDING_KEY, JSON.stringify(landing));
  } catch {
    // Storage unavailable (private mode) — attribution is best-effort.
  }
}

/** Forget the stashed landing once a sign-in has carried it to the server. */
export async function clearSignupLanding(): Promise<void> {
  await removeItem(SIGNUP_LANDING_KEY).catch(() => {});
}

/** Storage keys of the app's pending-link stashes (each app names its own). */
export interface PendingLinkKeys {
  friendInvite?: string;
  gameShare?: string;
  listInvite?: string;
}

async function read(key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  const value = await getItem(key).catch(() => null);
  return value?.trim() ? value.trim() : undefined;
}

/** Build the sign-in body's `acquisition`. Always an object (empty = nothing known). */
export async function collectSignupAcquisition(keys: PendingLinkKeys): Promise<SignupAcquisition> {
  const [friendInviteToken, gameShareToken, listInviteToken, landingRaw] = await Promise.all([
    read(keys.friendInvite),
    read(keys.gameShare),
    read(keys.listInvite),
    getItem(SIGNUP_LANDING_KEY).catch(() => null),
  ]);
  const acquisition: SignupAcquisition = { ...parseLanding(landingRaw) };
  if (friendInviteToken) acquisition.friendInviteToken = friendInviteToken;
  if (gameShareToken) acquisition.gameShareToken = gameShareToken;
  if (listInviteToken) acquisition.listInviteToken = listInviteToken;
  return acquisition;
}
