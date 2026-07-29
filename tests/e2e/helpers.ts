// Shared Playwright helpers for the workshop E2E suite.

import type { APIRequestContext, Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";

const AUTO_DEV_OPT_OUT_KEY = "workshop.disable-auto-dev";
const SESSION_TOKEN_KEY = "workshop.session.v1";

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
 * and, when renderButton() is called, inserts a plain <button> into the
 * given parent — production code (src/lib/oauth/GoogleSignInButton.web.tsx)
 * mounts that button into a View, so clicking the view's first descendant
 * fires the credential callback with the supplied JWT.
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
          renderButton: (parent: HTMLElement) => {
            while (parent.firstChild) parent.removeChild(parent.firstChild);
            const btn = parent.ownerDocument.createElement("button");
            btn.type = "button";
            btn.textContent = "Continue with Google";
            btn.style.cssText =
              "all: unset; cursor: pointer; padding: 12px 24px; border: 1px solid #444;";
            btn.addEventListener("click", () => {
              cb?.({ credential });
            });
            parent.appendChild(btn);
          },
          prompt: () => {
            queueMicrotask(() => cb?.({ credential }));
          },
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

/**
 * Drive the dev sign-in flow from the sign-in screen to the Lists home.
 * Caller is responsible for `disableAutoDevSignIn` + `page.goto("/")` and any
 * `page.route(...)` mocks (so route setup can run before navigation). The
 * helper handles the post-click branch where a fresh user lands on the
 * display-name screen vs an already-onboarded one lands on home directly, and
 * the branch where a context with no stored tab preference lands on Games
 * (`getPreferredHomeTab()` defaults to "games", and `/` redirects there).
 *
 * Landing is asserted on the create-list FAB, not the old `home-greeting`
 * testID — the greeting was dropped when the tab home headers were simplified
 * (#314). Specs still asserting `home-greeting` need the same swap.
 *
 * For tests that specifically exercise the display-name onboarding step
 * (e.g. `sign-in.spec.ts`), inline the assertions rather than using this
 * helper — it intentionally treats display-name entry as optional.
 */
export async function signInAsDev(
  page: Page,
  options: { displayName?: string } = {},
): Promise<void> {
  const displayName = options.displayName ?? "E2E User";
  await expect(page.getByTestId("sign-in-dev")).toBeVisible();
  await page.getByTestId("sign-in-dev").click();

  await Promise.race([
    page.getByTestId("display-name-input").waitFor({ state: "visible" }),
    // Both tab stacks stay mounted, so the switch matches twice — `.first()`
    // is the visible (foreground) one.
    page.getByTestId("tab-switch-lists").first().waitFor({ state: "visible" }),
  ]);

  if (
    await page
      .getByTestId("display-name-input")
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByTestId("display-name-input").fill(displayName);
    await page.getByTestId("display-name-save").click();
  }

  await goToListsHome(page);
}

/**
 * Land on the Lists home, hopping off the Games tab when that's where we are.
 * The branch keys off the URL, not visibility: both tab stacks stay mounted,
 * so the Lists FAB reports visible even while the Games screen is layered on
 * top of it (and the Games FAB then swallows the click).
 */
async function goToListsHome(page: Page): Promise<void> {
  if (new URL(page.url()).pathname.startsWith("/games")) {
    await page.getByTestId("tab-switch-lists").first().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/games"));
  }
  await expect(page.getByTestId("fab-create-list")).toBeVisible();
}

interface DevAuthResponse {
  token: string;
  user: { id: string; email: string | null; displayName: string | null };
  needsDisplayName: boolean;
}

/**
 * Mint a session for an arbitrary dev user via the backend's /v1/auth/dev
 * backdoor and seed the resulting token into localStorage so the next
 * page.goto skips sign-in entirely. The dev-sign-in button on the UI
 * hardcodes a single email — this helper is what lets one Playwright
 * test sign in TWO different users (owner + invitee) in two contexts.
 */
export async function signInAsDevUser(
  page: Page,
  request: APIRequestContext,
  opts: { email: string; displayName: string },
): Promise<DevAuthResponse> {
  const resp = await request.post("http://localhost:8787/v1/auth/dev", {
    data: { email: opts.email, displayName: opts.displayName },
  });
  if (!resp.ok()) {
    throw new Error(`/v1/auth/dev failed: ${resp.status()} ${await resp.text()}`);
  }
  const body = (await resp.json()) as DevAuthResponse;
  await disableAutoDevSignIn(page);
  await page.addInitScript(
    ([key, token]: string[]) => {
      try {
        window.localStorage.setItem(key, token);
      } catch {
        // best-effort
      }
    },
    [SESSION_TOKEN_KEY, body.token],
  );
  return body;
}
