// Pure rules for the operator-set App Store update nudge
// (`GET /v1/client/release`). No React, no Expo — unit-tested in
// appRelease.test.ts. The values are set ONLY by the operator in the admin
// dashboard (docs/release-nudge-runbook.md); this file only reads them.

import type { ClientReleaseResponse } from "@workshop/shared";

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** `"1.2.3"` → `[1, 2, 3]`; anything else (incl. null) → null. */
export function parseReleaseVersion(v: string | null | undefined): [number, number, number] | null {
  const m = v ? VERSION_RE.exec(v.trim()) : null;
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative when a < b, 0 when equal, positive when a > b. Null if either is unparseable. */
export function compareReleaseVersions(a: string, b: string): number | null {
  const pa = parseReleaseVersion(a);
  const pb = parseReleaseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function isOlder(installed: string, target: string | null): target is string {
  if (!target) return false;
  const cmp = compareReleaseVersions(installed, target);
  return cmp !== null && cmp < 0;
}

export type AppReleaseNudge =
  | { kind: "none" }
  | { kind: "required"; storeUrl: string | null; message: string | null }
  | { kind: "available"; latestVersion: string; storeUrl: string | null; message: string | null };

/**
 * What to show for this install. `installed` null (unknown binary version, or
 * web) never nudges — a nudge we can't justify is worse than none. An
 * unparseable server value is ignored the same way.
 */
export function releaseNudgeFor(
  installed: string | null,
  release: ClientReleaseResponse | null | undefined,
): AppReleaseNudge {
  if (!installed || !release || !parseReleaseVersion(installed)) return { kind: "none" };
  const storeUrl = release.storeUrl?.trim() || null;
  const message = release.message?.trim() || null;
  if (isOlder(installed, release.minimumVersion)) return { kind: "required", storeUrl, message };
  if (isOlder(installed, release.latestVersion)) {
    return { kind: "available", latestVersion: release.latestVersion, storeUrl, message };
  }
  return { kind: "none" };
}

/**
 * The `user_flags` value the banner's ✕ writes (`USER_FLAG_KEYS.appUpdateDismissed`).
 * Dismissal is per latestVersion: a newer one no longer matches, so it un-dismisses.
 */
export function dismissedFlagValue(latestVersion: string): { version: string } {
  return { version: latestVersion };
}

export function isBannerDismissed(flagValue: unknown, latestVersion: string): boolean {
  return (
    typeof flagValue === "object" &&
    flagValue !== null &&
    "version" in flagValue &&
    (flagValue as { version: unknown }).version === latestVersion
  );
}

/**
 * Dev-only web override (`?fakeInstalledVersion=1.0.0`) so the banner and the
 * blocking screen can be exercised in a browser. Callers must gate on `__DEV__`.
 */
export function fakeInstalledVersionFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get("fakeInstalledVersion");
  return raw && parseReleaseVersion(raw) ? raw.trim() : null;
}
