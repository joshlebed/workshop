// Every sign-up path stores a provider-supplied name through
// `normalizeProviderDisplayName`: a bad one becomes NULL (→ onboarding), a
// padded one is stored trimmed, and nothing 400s the sign-in. PGlite with the
// real migrations, so the users_display_name_check constraint is live too.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({ getDb: () => testDb }));
vi.mock("../../lib/oauth/apple.js", () => ({
  // The identity token doubles as the subject; Apple's JWT never carries a name.
  verifyAppleIdentityToken: vi.fn(async ({ identityToken }: { identityToken: string }) => ({
    sub: `apple-${identityToken}`,
    email: `${identityToken}@apple.test`,
  })),
}));
const googleNames = new Map<string, unknown>();
vi.mock("../../lib/oauth/google.js", () => ({
  verifyGoogleIdentityToken: vi.fn(async ({ idToken }: { idToken: string }) => ({
    sub: `google-${idToken}`,
    email: `${idToken}@google.test`,
    name: googleNames.get(idToken),
  })),
}));

import { resetConfigForTesting } from "../../lib/config.js";
import { authRoutes } from "./auth.js";

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

async function signIn(path: string, body: Record<string, unknown>) {
  const res = await authRoutes.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    user: { id: string; displayName: string | null };
    needsDisplayName: boolean;
  };
  const [row] = await rows<{ display_name: string | null }>(
    `SELECT display_name FROM users WHERE id = $1`,
    [json.user.id],
  );
  return { stored: row?.display_name, body: json };
}

const BAD_NAMES: [string, unknown][] = [
  ["blank", ""],
  ["whitespace-only", "   "],
  ["newlines only", "\n\r\n"],
  ["41 characters", "a".repeat(41)],
  ["filtered word", "big retard"],
];

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.DEV_AUTH_ENABLED = "1";
  process.env.GOOGLE_WEB_CLIENT_ID = "test-client";
  resetConfigForTesting();
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
});

afterAll(() => {
  delete process.env.DEV_AUTH_ENABLED;
  resetConfigForTesting();
});

describe("POST /v1/auth/apple display name", () => {
  it.each(BAD_NAMES)("signs in with no name for a %s fullName", async (label, fullName) => {
    const token = `apple-bad-${label.replace(/\W/g, "")}`;
    const { stored, body } = await signIn("/apple", { identityToken: token, fullName });
    expect(stored).toBeNull();
    expect(body.needsDisplayName).toBe(true);
  });

  it("signs in with no name for a fullName over the old 60-char cap", async () => {
    const { stored } = await signIn("/apple", {
      identityToken: "apple-huge",
      fullName: "a".repeat(500),
    });
    expect(stored).toBeNull();
  });

  it("signs in with no name for a null fullName", async () => {
    const { stored } = await signIn("/apple", { identityToken: "apple-null", fullName: null });
    expect(stored).toBeNull();
  });

  it("stores a padded, multi-line fullName cleaned", async () => {
    const { stored, body } = await signIn("/apple", {
      identityToken: "apple-padded",
      fullName: "  Ada\nLovelace  ",
    });
    expect(stored).toBe("Ada Lovelace");
    expect(body.user.displayName).toBe("Ada Lovelace");
    expect(body.needsDisplayName).toBe(false);
  });

  it("fills a nameless account later, but only with a valid name", async () => {
    await signIn("/apple", { identityToken: "apple-later", fullName: "   " });
    const again = await signIn("/apple", { identityToken: "apple-later", fullName: "  Grace " });
    expect(again.stored).toBe("Grace");
  });
});

describe("POST /v1/auth/google display name", () => {
  it.each(BAD_NAMES)("stores NULL for a %s name claim", async (label, name) => {
    const token = `google-bad-${label.replace(/\W/g, "")}`;
    googleNames.set(token, name);
    const { stored, body } = await signIn("/google", { idToken: token });
    expect(stored).toBeNull();
    expect(body.needsDisplayName).toBe(true);
  });

  it("stores NULL for a non-string name claim", async () => {
    googleNames.set("google-number", 42);
    expect((await signIn("/google", { idToken: "google-number" })).stored).toBeNull();
  });

  it("stores a padded name claim trimmed", async () => {
    googleNames.set("google-padded", "  Grace Hopper\n");
    expect((await signIn("/google", { idToken: "google-padded" })).stored).toBe("Grace Hopper");
  });
});

describe("POST /v1/auth/dev display name", () => {
  it.each(BAD_NAMES)("stores NULL for a %s displayName", async (label, displayName) => {
    const email = `dev-bad-${label.replace(/\W/g, "")}@dev.test`;
    const { stored } = await signIn("/dev", { email, displayName });
    expect(stored).toBeNull();
  });

  it("stores a padded displayName trimmed", async () => {
    const { stored } = await signIn("/dev", {
      email: "dev-padded@dev.test",
      displayName: "  Alan  ",
    });
    expect(stored).toBe("Alan");
  });
});

describe("users_display_name_check", () => {
  it("rejects a whitespace-only name", async () => {
    await expect(
      rows(`INSERT INTO users (email, display_name) VALUES ('ws@db.test', '   ')`),
    ).rejects.toThrow(/users_display_name_check/);
  });

  it("rejects an empty name", async () => {
    await expect(
      rows(`INSERT INTO users (email, display_name) VALUES ('empty@db.test', '')`),
    ).rejects.toThrow(/users_display_name_check/);
  });

  it("rejects a name over 40 characters", async () => {
    await expect(
      rows(`INSERT INTO users (email, display_name) VALUES ('long@db.test', $1)`, ["a".repeat(41)]),
    ).rejects.toThrow(/users_display_name_check/);
  });

  it("accepts NULL, a 40-character name, and a 40-code-point emoji name", async () => {
    await rows(`INSERT INTO users (email, display_name) VALUES ('null@db.test', NULL)`);
    await rows(`INSERT INTO users (email, display_name) VALUES ('forty@db.test', $1)`, [
      "a".repeat(40),
    ]);
    await rows(`INSERT INTO users (email, display_name) VALUES ('emoji@db.test', $1)`, [
      "🎬".repeat(40),
    ]);
  });
});
