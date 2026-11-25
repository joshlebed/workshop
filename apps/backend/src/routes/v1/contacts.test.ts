// Contacts "find and invite" (onboarding spike #3): "Let friends find me"
// (`/v1/users/me/discoverability`), digest matching
// (`POST /v1/friends/contacts/match`) and the funnel events
// (`POST /v1/telemetry/contacts`), against PGlite with the real migrations.

import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { contactHandleDigest } from "@workshop/shared/contacts";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { resetConfigForTesting } from "../../lib/config.js";
import { pepperDigest, rehashAllContactHandles } from "../../lib/contactHandles.js";
import { friendRoutes } from "./friends.js";
import { telemetryRoutes } from "./telemetry.js";
import { userRoutes } from "./users.js";

const me = "00000000-0000-4000-8000-000000000101";
const sam = "00000000-0000-4000-8000-000000000102"; // discoverable
const riley = "00000000-0000-4000-8000-000000000103"; // not discoverable
const blocker = "00000000-0000-4000-8000-000000000104"; // discoverable, blocked me
const pal = "00000000-0000-4000-8000-000000000105"; // discoverable, already a friend
const asker = "00000000-0000-4000-8000-000000000106"; // discoverable, requested me
const relay = "00000000-0000-4000-8000-000000000107"; // Apple relay email
const noEmail = "00000000-0000-4000-8000-000000000108";
const limited = "00000000-0000-4000-8000-000000000109"; // used for the rate limit

const emailOf: Record<string, string> = {
  [me]: "me@example.com",
  [sam]: "Sam@Example.com",
  [riley]: "riley@example.com",
  [blocker]: "blocker@example.com",
  [pal]: "pal@example.com",
  [asker]: "asker@example.com",
  [relay]: "abc123@privaterelay.appleid.com",
};

const digestOf = (email: string) => contactHandleDigest("email", email.trim().toLowerCase());

function authHeaders(asUser: string): Record<string, string> {
  return {
    Authorization: `Bearer ${signSession(asUser)}`,
    "Content-Type": "application/json",
  };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

function setDiscoverable(asUser: string, email: boolean) {
  return userRoutes.request("/me/discoverability", {
    method: "PUT",
    headers: authHeaders(asUser),
    body: JSON.stringify({ email }),
  });
}

function match(asUser: string, hashes: string[], surface?: string) {
  return friendRoutes.request("/contacts/match", {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify(surface ? { hashes, surface } : { hashes }),
  });
}

type MatchBody = {
  matches: { userId: string; displayName: string; digests: string[]; relationship: string }[];
};

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, $2, 'Me'), ($3, $4, 'Sam'), ($5, $6, 'Riley'), ($7, $8, 'Blocker'),
       ($9, $10, 'Pal'), ($11, $12, 'Asker'), ($13, $14, 'Relay'),
       ($15, NULL, 'No Email'), ($16, 'limited@example.com', 'Limited')`,
    [
      me,
      emailOf[me],
      sam,
      emailOf[sam],
      riley,
      emailOf[riley],
      blocker,
      emailOf[blocker],
      pal,
      emailOf[pal],
      asker,
      emailOf[asker],
      relay,
      emailOf[relay],
      noEmail,
      limited,
    ],
  );
  const [low, high] = [me, pal].sort();
  await rows("INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)", [low, high]);
  await rows(
    "INSERT INTO friend_requests (inviter_id, invitee_id, status) VALUES ($1, $2, 'pending')",
    [asker, me],
  );
  await rows("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)", [blocker, me]);

  for (const id of [sam, blocker, pal, asker]) {
    expect((await setDiscoverable(id, true)).status).toBe(200);
  }
}, 60_000);

describe("GET/PUT /v1/users/me/discoverability", () => {
  it("is off by default and offers the account email", async () => {
    const res = await userRoutes.request("/me/discoverability", { headers: authHeaders(riley) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: { enabled: false, address: "riley@example.com", isRelay: false },
      phone: { enabled: false, available: false },
    });
  });

  it("stores a peppered hash of the email — never the email or the bare digest", async () => {
    const stored = await rows<{ kind: string; hash: string }>(
      "SELECT kind, hash FROM user_contact_handles WHERE user_id = $1",
      [sam],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.kind).toBe("email");
    const digest = digestOf("sam@example.com");
    expect(stored[0]?.hash).toBe(pepperDigest(digest));
    expect(stored[0]?.hash).not.toBe(digest);
    expect(stored[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify(await rows("SELECT * FROM user_contact_handles"));
    expect(dump).not.toContain("example.com");
    expect(dump).not.toContain(digest);
  });

  it("flags an Apple relay address, and still lets it be turned on", async () => {
    const res = await setDiscoverable(relay, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: { enabled: boolean; isRelay: boolean } };
    expect(body.email).toMatchObject({ enabled: true, isRelay: true });
    await setDiscoverable(relay, false);
  });

  it("refuses an account with no email", async () => {
    const res = await setDiscoverable(noEmail, true);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("NO_EMAIL");
  });

  it("rejects a phone number — phone needs verification first", async () => {
    const res = await userRoutes.request("/me/discoverability", {
      method: "PUT",
      headers: authHeaders(riley),
      body: JSON.stringify({ email: true, phone: "+14155550123" }),
    });
    expect(res.status).toBe(400);
    expect(await rows("SELECT 1 FROM user_contact_handles WHERE user_id = $1", [riley])).toEqual(
      [],
    );
  });

  it("turning it off deletes the handle and records both switches", async () => {
    expect((await setDiscoverable(riley, true)).status).toBe(200);
    expect(
      await rows("SELECT 1 FROM user_contact_handles WHERE user_id = $1", [riley]),
    ).toHaveLength(1);
    const off = await setDiscoverable(riley, false);
    expect(((await off.json()) as { email: { enabled: boolean } }).email.enabled).toBe(false);
    expect(await rows("SELECT 1 FROM user_contact_handles WHERE user_id = $1", [riley])).toEqual(
      [],
    );
    const events = await rows<{ event: string }>(
      "SELECT event FROM contact_discovery_events WHERE user_id = $1 ORDER BY created_at",
      [riley],
    );
    expect(events.map((e) => e.event)).toEqual(["discoverable_on", "discoverable_off"]);
  });
});

describe("POST /v1/friends/contacts/match", () => {
  it("returns only discoverable, unblocked people, with the digests they matched", async () => {
    const hashes = [
      digestOf(emailOf[sam] as string),
      digestOf(emailOf[riley] as string), // not discoverable
      digestOf(emailOf[blocker] as string), // blocked me
      digestOf(emailOf[me] as string), // myself
      digestOf("nobody@example.com"),
    ];
    // Me turns discoverable too, to prove self is excluded.
    await setDiscoverable(me, true);
    const res = await match(me, hashes, "friends");
    expect(res.status).toBe(200);
    const body = (await res.json()) as MatchBody;
    expect(body.matches).toEqual([
      {
        userId: sam,
        displayName: "Sam",
        digests: [digestOf("sam@example.com")],
        relationship: "none",
      },
    ]);
    await setDiscoverable(me, false);
  });

  it("says how the viewer already relates to each match", async () => {
    const res = await match(me, [
      digestOf(emailOf[pal] as string),
      digestOf(emailOf[asker] as string),
    ]);
    const body = (await res.json()) as MatchBody;
    const byId = Object.fromEntries(body.matches.map((m) => [m.userId, m.relationship]));
    expect(byId).toEqual({ [pal]: "friend", [asker]: "incoming" });

    await rows(
      "INSERT INTO friend_requests (inviter_id, invitee_id, status) VALUES ($1, $2, 'pending')",
      [me, sam],
    );
    const again = (await (await match(me, [digestOf("sam@example.com")])).json()) as MatchBody;
    expect(again.matches[0]?.relationship).toBe("outgoing");
  });

  it("stops matching someone the moment they turn discoverability off", async () => {
    await setDiscoverable(sam, false);
    const body = (await (await match(riley, [digestOf("sam@example.com")])).json()) as MatchBody;
    expect(body.matches).toEqual([]);
    await setDiscoverable(sam, true);
  });

  it("records counts only — never a submitted digest", async () => {
    const digest = digestOf("sam@example.com");
    await match(riley, [digest, digest, digestOf("x@example.com")], "post_accept");
    const events = await rows<{ count: number; matched_count: number; detail: string }>(
      "SELECT count, matched_count, detail FROM contact_discovery_events WHERE user_id = $1 AND event = 'matched' ORDER BY created_at DESC LIMIT 1",
      [riley],
    );
    expect(events[0]).toEqual({ count: 2, matched_count: 1, detail: "post_accept" });
    const dump = JSON.stringify(await rows("SELECT * FROM contact_discovery_events"));
    expect(dump).not.toContain(digest);
    expect(dump).not.toContain(pepperDigest(digest));
  });

  it("validates the batch: 1–500 lowercase hex digests", async () => {
    // Rate-limited before validation, so a fresh caller (4 calls, limit 5).
    expect((await match(noEmail, [])).status).toBe(400);
    expect((await match(noEmail, ["sam@example.com"])).status).toBe(400);
    expect((await match(noEmail, [digestOf("a@b.co").toUpperCase()])).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, i) =>
      createHash("sha256").update(String(i)).digest("hex"),
    );
    expect((await match(noEmail, tooMany)).status).toBe(400);
  });

  it("allows 5 calls per user per hour", async () => {
    // A fixed window can straddle an hour boundary; pin the clock inside one.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:15:00Z"));
    try {
      for (let i = 0; i < 5; i++) {
        expect((await match(limited, [digestOf("sam@example.com")])).status).toBe(200);
      }
      const res = await match(limited, [digestOf("sam@example.com")]);
      expect(res.status).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST /v1/telemetry/contacts", () => {
  beforeEach(async () => {
    await rows("DELETE FROM contact_discovery_events WHERE user_id = $1", [noEmail]);
  });

  function send(body: unknown) {
    return telemetryRoutes.request("/contacts", {
      method: "POST",
      headers: authHeaders(noEmail),
      body: JSON.stringify(body),
    });
  }

  it("stores funnel events with counts and the add target", async () => {
    expect((await send({ event: "prompt_shown", detail: "friends" })).status).toBe(200);
    expect((await send({ event: "limited_granted", count: 3 })).status).toBe(200);
    expect((await send({ event: "add", targetUserId: sam })).status).toBe(200);
    expect((await send({ event: "invite_sent", detail: "sms", targetUserId: sam })).status).toBe(
      200,
    );
    const events = await rows<{
      event: string;
      count: number | null;
      target_user_id: string | null;
    }>(
      "SELECT event, count, target_user_id FROM contact_discovery_events WHERE user_id = $1 ORDER BY created_at",
      [noEmail],
    );
    expect(events).toEqual([
      { event: "prompt_shown", count: null, target_user_id: null },
      { event: "limited_granted", count: 3, target_user_id: null },
      { event: "add", count: null, target_user_id: sam },
      // A target only means something on `add`; elsewhere it is dropped.
      { event: "invite_sent", count: null, target_user_id: null },
    ]);
  });

  it("rejects unknown events and free text", async () => {
    expect((await send({ event: "matched" })).status).toBe(400);
    expect((await send({ event: "add", detail: "Sam Smith" })).status).toBe(400);
  });
});

describe("pepper rotation", () => {
  it("a new pepper strands old hashes until they are rehashed from users.email", async () => {
    const digest = digestOf("sam@example.com");
    process.env.CONTACT_HASH_PEPPER = "p".repeat(40);
    resetConfigForTesting();
    try {
      let body = (await (await match(asker, [digest])).json()) as MatchBody;
      expect(body.matches).toEqual([]);
      const result = await rehashAllContactHandles();
      expect(result.updated).toBeGreaterThan(0);
      body = (await (await match(asker, [digest])).json()) as MatchBody;
      expect(body.matches.map((m) => m.userId)).toEqual([sam]);
    } finally {
      delete process.env.CONTACT_HASH_PEPPER;
      resetConfigForTesting();
      await rehashAllContactHandles();
    }
  });
});
