// Shared Playwright helpers for the workshop E2E suite.
//
// Data hygiene (the sandbox DB is a copy of production): no spec signs in as,
// creates data in, or mutates the real owner account that the web app's auto
// dev sign-in uses. Every spec mints its own scratch users through
// `/v1/auth/dev` (`ux-scratch-e2e-<name>-<stamp>@workshop.local`), seeds that
// session into the page with the auto sign-in disabled, names the lists it
// makes `zz-ux-scratch-e2e-…`, and calls `cleanupScratchUser` afterwards, which
// deletes every list the scratch user owns.
//
// Auth rate limit: `/v1/auth/*` allows 30 requests a minute per client IP, and
// every page load spends one or two of them (the session upgrade or `/me`).
// Locally every caller shares the "unknown" bucket, so a suite run (and other
// agents or a developer in the same sandbox) would trip it. The suite's own
// auth requests carry an `X-Forwarded-For` lane per spec/test so they count in
// their own bucket; nothing else changes about the request.

import {
  type Browser,
  type BrowserContext,
  test as base,
  expect,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";

export { expect };

const API = process.env.WORKSHOP_E2E_API_URL ?? "http://localhost:8787";

const AUTO_DEV_OPT_OUT_KEY = "workshop.disable-auto-dev";
const SESSION_TOKEN_KEY = "workshop.session.v1";
const RUN_STAMP = Date.now().toString(36);

let laneSeq = 0;
/** A fresh rate-limit lane (an `X-Forwarded-For` value) for one spec or test. */
function newAuthLane(name: string): string {
  laneSeq += 1;
  return `e2e-${name}-${RUN_STAMP}-${process.pid}-${laneSeq}`.replace(/[^\w.-]/g, "-");
}

/** Route the context's `/v1/auth/*` requests through their own rate-limit lane. */
async function laneAuthRequests(context: BrowserContext, lane: string): Promise<void> {
  await context.route(`${API}/v1/auth/**`, async (route: Route) => {
    await route.continue({
      headers: { ...route.request().headers(), "x-forwarded-for": lane },
    });
  });
}

/**
 * `test` with each test's browser context on its own auth rate-limit lane.
 * Specs import `test` from here instead of `@playwright/test`.
 */
export const test = base.extend<{ authLane: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures take a destructured first arg.
  authLane: async ({}, use, testInfo) => {
    await use(newAuthLane(testInfo.titlePath.join("-").slice(0, 40)));
  },
  context: async ({ context, authLane }, use) => {
    await laneAuthRequests(context, authLane);
    await use(context);
  },
});

/** A second (or third) browser context, on its own auth lane. */
export async function newLanedContext(browser: Browser, name: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await laneAuthRequests(context, newAuthLane(name));
  return context;
}

/**
 * Disable the boot-time auto-dev-sign-in. With EXPO_PUBLIC_DEV_AUTH=1 the
 * AuthProvider signs in as the real owner account unless this flag is set in
 * localStorage, so every page a spec opens sets it before its first load.
 */
export async function disableAutoDevSignIn(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(
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
 * Seed a session token into the page (or every page of a context) before it
 * loads, with the auto sign-in disabled. Only writes when no session is
 * stored, so a reload keeps the managed session the app upgraded to instead
 * of upgrading the seeded token again.
 */
export async function seedSession(target: Page | BrowserContext, token: string): Promise<void> {
  await disableAutoDevSignIn(target);
  await target.addInitScript(
    ([key, value]: string[]) => {
      try {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      } catch {
        // best-effort
      }
    },
    [SESSION_TOKEN_KEY, token],
  );
}

interface DevAuthResponse {
  token: string;
  user: { id: string; email: string | null; displayName: string | null };
  needsDisplayName: boolean;
}

export interface ScratchUser extends DevAuthResponse {
  email: string;
  /** `Authorization` header for API calls as this user. */
  headers: Record<string, string>;
  /** The rate-limit lane its API calls use. */
  lane: string;
}

/** `ux-scratch-e2e-<name>-<stamp>@workshop.local`, unique per call. */
export function scratchEmail(name: string): string {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `ux-scratch-e2e-${name}-${stamp}@workshop.local`;
}

/** A unique list name in the scratch namespace. */
export function scratchListName(name: string): string {
  return `zz-ux-scratch-e2e-${name}-${Date.now()}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mint a brand-new scratch user through the backend's dev backdoor. Pass
 * `displayName: null` for a user who still has to pick a display name.
 * Retries a 429 once the window has passed (other sandbox users may share
 * the lane's IP bucket only if they spoof the same lane, which they don't).
 */
export async function mintScratchUser(
  name: string,
  opts: { displayName?: string | null; email?: string } = {},
): Promise<ScratchUser> {
  const email = opts.email ?? scratchEmail(name);
  const displayName = opts.displayName === undefined ? `E2E ${name}` : opts.displayName;
  const lane = newAuthLane(name);
  const body: Record<string, string> = { email };
  if (displayName) body.displayName = displayName;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}/v1/auth/dev`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": lane,
        "x-workshop-client": "workshop",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      await sleep(61_000);
      continue;
    }
    if (!res.ok) throw new Error(`/v1/auth/dev failed: ${res.status} ${await res.text()}`);
    const auth = (await res.json()) as DevAuthResponse;
    return { ...auth, email, lane, headers: { Authorization: `Bearer ${auth.token}` } };
  }
  throw new Error("/v1/auth/dev stayed rate limited");
}

/** JSON request to the backend as a scratch user. Throws on a non-2xx. */
export async function api<T = unknown>(
  user: ScratchUser,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...user.headers,
      "x-workshop-client": "workshop",
      "x-forwarded-for": user.lane,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export interface CreatedList {
  id: string;
  name: string;
  shareSlug?: string | null;
}

/** Create a list as the scratch user. `name` is prefixed into the scratch namespace. */
export async function createScratchList(
  user: ScratchUser,
  opts: {
    name: string;
    emoji?: string;
    color?: string;
    itemKind?: string | null;
    modules?: string[];
  },
): Promise<CreatedList> {
  const res = await api<{ list: CreatedList }>(user, "POST", "/v1/lists", {
    name: opts.name.startsWith("zz-ux-scratch-e2e") ? opts.name : scratchListName(opts.name),
    emoji: opts.emoji ?? "🧪",
    color: opts.color ?? "ocean",
    itemKind: opts.itemKind === undefined ? "plain" : opts.itemKind,
    modules: opts.modules ?? ["todo"],
  });
  return res.list;
}

/** Add an item to a list as the scratch user. */
export async function addScratchItem(
  user: ScratchUser,
  listId: string,
  item: { title: string; kind?: string; url?: string; note?: string; tags?: string[] },
): Promise<{ id: string; title: string }> {
  const res = await api<{ item: { id: string; title: string } }>(
    user,
    "POST",
    `/v1/lists/${listId}/items`,
    item,
  );
  return res.item;
}

/**
 * Delete every live list the scratch user owns (renamed into the scratch
 * namespace first, so a list made through a one-tap template with its
 * default name is still recognisable as test data once archived). Lists the
 * user only joined are left to their owner's cleanup.
 */
export async function cleanupScratchUser(user: ScratchUser | null | undefined): Promise<void> {
  if (!user) return;
  try {
    const { lists } = await api<{ lists: { id: string; name: string; role: string }[] }>(
      user,
      "GET",
      "/v1/lists",
    );
    for (const list of lists) {
      if (list.role !== "owner") continue;
      if (!list.name.startsWith("zz-ux-scratch-e2e")) {
        await api(user, "PATCH", `/v1/lists/${list.id}`, {
          name: `zz-ux-scratch-e2e-${list.name}`.slice(0, 80),
        }).catch(() => undefined);
      }
      await api(user, "DELETE", `/v1/lists/${list.id}`).catch(() => undefined);
    }
  } catch (error) {
    console.warn(`cleanup for ${user.email} failed`, error);
  }
}

/** The toast whose message contains `text` (not the screen-reader echo of it). */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('[data-testid^="toast-"]', { hasText: text }).first();
}

/** Every item title on the open list, top to bottom. */
export function itemTitles(page: Page): Promise<(string | null)[]> {
  return page
    .locator('[data-testid^="item-title-"]')
    .evaluateAll((els) => els.map((e) => e.textContent));
}

/** Item rows only: `item-row-<id>`, not the `item-row-body-` / `-check-` / `-menu-` parts. */
export const ITEM_ROWS =
  '[data-testid^="item-row-"]:not([data-testid^="item-row-body-"]):not([data-testid^="item-row-check-"]):not([data-testid^="item-row-menu-"])';

/** The item row whose title contains `title`. */
export function itemRow(page: Page, title: string): Locator {
  // Match by substring: the title element may carry more than the title.
  return page.locator(ITEM_ROWS, {
    has: page.locator('[data-testid^="item-title-"]', { hasText: title }),
  });
}

/**
 * Install a Google Identity Services stub on `window.google` BEFORE the
 * page loads. The stub records the callback registered via initialize()
 * and, when renderButton() is called, inserts a plain <button> into the
 * given parent — production code (GoogleSignInButton.web.tsx) mounts that
 * button into a View, so clicking the view's first descendant fires the
 * credential callback with the supplied JWT.
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
 * Point the sign-in screen's dev button at a scratch account. The button
 * hardcodes the real owner's email; this rewrites the request body so a spec
 * can drive the real button without touching that account.
 */
export async function redirectDevSignIn(page: Page, email: string): Promise<void> {
  await page.route(`${API}/v1/auth/dev`, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    // `fallback`, not `continue`: the context's auth-lane route still applies.
    await route.fallback({ postData: JSON.stringify({ email }) });
  });
}
