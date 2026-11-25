import { CONTACT_MATCH_MAX_HASHES, contactHandleDigest } from "@workshop/shared/contacts";
import { describe, expect, it } from "vitest";
import {
  CONTACTS_CONSENT_POINTS,
  contactDigests,
  indexDigests,
  MAX_MATCH_CALLS_PER_SCAN,
  mergeMatches,
  partitionContacts,
  planMatchCalls,
} from "./contactMatching";
import type { DeviceContact } from "./contacts";

const sam: DeviceContact = {
  id: "c1",
  name: "Sam Rivera",
  emails: ["Sam@Example.com", "sam@example.com"],
  phones: ["+1 415 555 0101"],
};
const riley: DeviceContact = { id: "c2", name: "Riley", emails: [], phones: ["(415) 555-0102"] };
const quinn: DeviceContact = { id: "c3", name: "", emails: ["quinn@example.com"], phones: [] };
const empty: DeviceContact = { id: "c4", name: "Nobody", emails: [], phones: [] };

describe("contactDigests", () => {
  it("hashes normalized emails once and never phones (phone matching waits for OTP)", () => {
    expect(contactDigests(sam, "US")).toEqual([contactHandleDigest("email", "sam@example.com")]);
    expect(contactDigests(riley, "US")).toEqual([]);
  });
  it("never puts a raw handle on the wire", () => {
    const wire = JSON.stringify(contactDigests(sam, "US"));
    expect(wire).not.toContain("example.com");
    expect(wire).not.toContain("415");
  });
});

describe("planMatchCalls", () => {
  it("skips digests already checked and caps the calls per scan", () => {
    const digests = Array.from({ length: CONTACT_MATCH_MAX_HASHES * 4 + 10 }, (_, i) =>
      contactHandleDigest("email", `u${i}@example.com`),
    );
    const checked = new Set(digests.slice(0, 10));
    const plan = planMatchCalls(digests, checked);
    expect(plan.batches).toHaveLength(MAX_MATCH_CALLS_PER_SCAN);
    expect(plan.batches.every((b) => b.length <= CONTACT_MATCH_MAX_HASHES)).toBe(true);
    expect(plan.batches[0]?.[0]).toBe(digests[10]);
    expect(plan.skipped).toBe(CONTACT_MATCH_MAX_HASHES);
  });
  it("plans nothing when everything was checked", () => {
    const d = contactDigests(sam, "US");
    expect(planMatchCalls(d, new Set(d))).toEqual({ batches: [], skipped: 0 });
  });
});

describe("partitionContacts", () => {
  it("puts matched contacts on HighScore and the rest (with a way to reach them) in Not yet", () => {
    const contacts = [sam, riley, quinn, empty];
    const index = indexDigests(contacts, "US");
    const samDigest = contactHandleDigest("email", "sam@example.com");
    const lists = partitionContacts(contacts, index, [
      { userId: "u-sam", displayName: "Sammy", digests: [samDigest], relationship: "none" },
    ]);
    expect(lists.onHighScore).toEqual([
      {
        match: {
          userId: "u-sam",
          displayName: "Sammy",
          digests: [samDigest],
          relationship: "none",
        },
        contactName: "Sam Rivera",
      },
    ]);
    expect(lists.notYet.map((c) => c.id)).toEqual(["c2", "c3"]);
  });
});

describe("mergeMatches", () => {
  it("unions a user's digests across batches and keeps the newest relationship", () => {
    const merged = mergeMatches(
      [{ userId: "a", displayName: "A", digests: ["1"], relationship: "none" }],
      [
        { userId: "a", displayName: "A", digests: ["2"], relationship: "outgoing" },
        { userId: "b", displayName: "B", digests: ["3"], relationship: "none" },
      ],
    );
    expect(merged).toEqual([
      { userId: "a", displayName: "A", digests: ["1", "2"], relationship: "outgoing" },
      { userId: "b", displayName: "B", digests: ["3"], relationship: "none" },
    ]);
  });
});

describe("consent copy", () => {
  it("says what is sent, what is kept and how to stop being found", () => {
    const text = CONTACTS_CONSENT_POINTS.map((p) => `${p.title}: ${p.body}`).join("\n");
    expect(text).toContain("one-way code (a hash) made on this phone");
    expect(text).toContain("Never names, phone numbers or addresses");
    expect(text).toContain("What's kept: Nothing");
    expect(text).toContain("turn yours off any time");
  });
});
