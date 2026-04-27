// Shared Playwright helpers for the workshop E2E suite.

import type { Page, Route } from "@playwright/test";

const AUTO_DEV_OPT_OUT_KEY = "workshop.disable-auto-dev";

/**
 * Disable the boot-time auto-dev-sign-in. With EXPO_PUBLIC_DEV_AUTH=1 the
 * AuthProvider auto-signs-in unless this flag is set in localStorage. Tests
 * that need the sign-in screen to render call this before page.goto.
 */
export async function disableAutoDevSignIn(page: Page): Promise<void> {
  await page.addInitScript(
    ([key]: string[]) => {
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        // Some browser contexts deny localStorage; the flag is best-effort.
      }
    },
    [AUTO_DEV_OPT_OUT_KEY],
  );
}

/**
 * Install a Google Identity Services stub on `window.google` BEFORE the
 * page loads. The stub records the callback registered via initialize()
 * and resolves it with the supplied JWT when prompt() is called. The
 * production code paths in src/lib/oauth/google.web.ts fall back to
 * `prompt()` when no rendered button can be found, so this is reachable.
 */
export async function stubGoogleIdentityServices(page: Page, jwt: string): Promise<void> {
  await page.addInitScript((credential: string) => {
    let cb: ((response: { credential: string }) => void) | null = null;
    const stub = {
      accounts: {
        id: {
          initialize: ({ callback }: { callback: (r: { credential: string }) => void }) => {
            cb = callback;
          },
          prompt: () => {
            queueMicrotask(() => cb?.({ credential }));
          },
          // No-op renderButton — the production code falls back to prompt()
          // when it can't find a clickable element inside the host.
          renderButton: () => {},
          cancel: () => {},
          disableAutoSelect: () => {},
        },
      },
    };
    Object.defineProperty(window, "google", {
      configurable: true,
      writable: true,
      value: stub,
    });
  }, jwt);
}

/**
 * Mock POST /v1/auth/google to return a pre-fetched AuthResponse. The
 * response has to come from a real backend round-trip (via /v1/auth/dev)
 * so the token is signed by the running server's SESSION_SECRET and
 * subsequent authenticated requests work.
 */
export async function mockGoogleAuthEndpoint(page: Page, authResponse: unknown): Promise<void> {
  await page.route("**/v1/auth/google", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(authResponse),
    });
  });
}
