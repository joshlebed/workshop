import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  contactHandleDigest,
  isAppleRelayEmail,
  normalizeEmail,
  normalizePhoneE164,
  sha256Hex,
} from "./contacts";

describe("sha256Hex", () => {
  const node = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

  it("matches Node's SHA-256 across block boundaries and non-ASCII input", () => {
    const inputs = [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(63),
      "a".repeat(64),
      "a".repeat(1000),
      "highscore-contact-v1|email|sam@example.com",
      "Zoë · 日本 · 🎮",
    ];
    for (const input of inputs) expect(sha256Hex(input)).toBe(node(input));
  });
});

describe("contactHandleDigest", () => {
  it("is a domain-separated SHA-256 of kind + normalized handle", () => {
    expect(contactHandleDigest("email", "sam@example.com")).toBe(
      createHash("sha256").update("highscore-contact-v1|email|sam@example.com").digest("hex"),
    );
    expect(contactHandleDigest("email", "x")).not.toBe(contactHandleDigest("phone", "x"));
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Sam@Example.COM ")).toBe("sam@example.com");
  });
  it("rejects non-emails", () => {
    expect(normalizeEmail("sam")).toBeNull();
    expect(normalizeEmail("sam@localhost")).toBeNull();
    expect(normalizeEmail("a b@c.d")).toBeNull();
  });
  it("spots Apple relay addresses", () => {
    expect(isAppleRelayEmail("abc123@privaterelay.appleid.com")).toBe(true);
    expect(isAppleRelayEmail("sam@icloud.com")).toBe(false);
  });
});

describe("normalizePhoneE164", () => {
  it("keeps numbers written with a country code", () => {
    expect(normalizePhoneE164("+1 (415) 555-0123", null)).toBe("+14155550123");
    expect(normalizePhoneE164("+44 7700 900123", "US")).toBe("+447700900123");
    expect(normalizePhoneE164("0044 7700 900123", "US")).toBe("+447700900123");
  });
  it("reads NANP national numbers from a US/CA device", () => {
    expect(normalizePhoneE164("(415) 555-0123", "US")).toBe("+14155550123");
    expect(normalizePhoneE164("1-415-555-0123", "CA")).toBe("+14155550123");
    expect(normalizePhoneE164("011 44 7700 900123", "US")).toBe("+447700900123");
    expect(normalizePhoneE164("555-0123", "US")).toBeNull();
  });
  it("drops the trunk prefix elsewhere", () => {
    expect(normalizePhoneE164("07700 900123", "GB")).toBe("+447700900123");
  });
  it("ignores extensions", () => {
    expect(normalizePhoneE164("+1 415 555 0123 x45", null)).toBe("+14155550123");
    expect(normalizePhoneE164("+1 415 555 0123;ext=45", null)).toBe("+14155550123");
  });
  it("refuses to guess without a known region", () => {
    expect(normalizePhoneE164("4155550123", null)).toBeNull();
    expect(normalizePhoneE164("4155550123", "ZZ")).toBeNull();
    expect(normalizePhoneE164("+12", null)).toBeNull();
  });
});
