import { describe, expect, it } from "vitest";
import {
  assertHostnameSafe,
  classifyIp,
  parseAndValidateUrl,
  SsrfBlockedError,
} from "./ssrf-guard.js";

describe("classifyIp", () => {
  it("allows public unicast v4", () => {
    expect(classifyIp("8.8.8.8")).toEqual({ ok: true });
    expect(classifyIp("1.1.1.1")).toEqual({ ok: true });
  });

  it("blocks loopback", () => {
    const v = classifyIp("127.0.0.1");
    expect(v.ok).toBe(false);
  });

  it("blocks RFC1918", () => {
    expect(classifyIp("10.0.0.1").ok).toBe(false);
    expect(classifyIp("192.168.1.1").ok).toBe(false);
    expect(classifyIp("172.16.5.4").ok).toBe(false);
  });

  it("blocks AWS metadata IP (169.254.169.254)", () => {
    const v = classifyIp("169.254.169.254");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/linkLocal|aws-metadata/);
  });

  it("blocks all other link-local", () => {
    expect(classifyIp("169.254.1.1").ok).toBe(false);
  });

  it("blocks broadcast and reserved", () => {
    expect(classifyIp("255.255.255.255").ok).toBe(false);
    expect(classifyIp("0.0.0.0").ok).toBe(false);
  });

  it("blocks multicast", () => {
    expect(classifyIp("224.0.0.1").ok).toBe(false);
  });

  it("blocks ipv6 loopback and link-local", () => {
    expect(classifyIp("::1").ok).toBe(false);
    expect(classifyIp("fe80::1").ok).toBe(false);
  });

  it("blocks ipv6 unique-local", () => {
    expect(classifyIp("fc00::1").ok).toBe(false);
    expect(classifyIp("fd00::1").ok).toBe(false);
  });

  it("blocks ipv4-mapped private addresses (::ffff:10.0.0.1)", () => {
    const v = classifyIp("::ffff:10.0.0.1");
    expect(v.ok).toBe(false);
  });

  it("allows ipv4-mapped public addresses (::ffff:8.8.8.8)", () => {
    expect(classifyIp("::ffff:8.8.8.8")).toEqual({ ok: true });
  });

  it("rejects unparseable input", () => {
    const v = classifyIp("not-an-ip");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/unparseable/);
  });
});

describe("parseAndValidateUrl", () => {
  it("accepts http and https", () => {
    expect(parseAndValidateUrl("http://example.com/").href).toBe("http://example.com/");
    expect(parseAndValidateUrl("https://example.com/path?x=1").href).toBe(
      "https://example.com/path?x=1",
    );
  });

  it("rejects unparseable URLs", () => {
    expect(() => parseAndValidateUrl("not a url")).toThrow(SsrfBlockedError);
  });

  it("rejects non-http(s) protocols", () => {
    expect(() => parseAndValidateUrl("file:///etc/passwd")).toThrow(/protocol not allowed/);
    expect(() => parseAndValidateUrl("ftp://example.com")).toThrow(/protocol not allowed/);
    expect(() => parseAndValidateUrl("javascript:alert(1)")).toThrow(/protocol not allowed/);
  });

  it("rejects userinfo URLs", () => {
    expect(() => parseAndValidateUrl("http://user:pw@example.com/")).toThrow(/userinfo/);
  });
});

describe("assertHostnameSafe", () => {
  it("accepts a public IP literal without DNS", async () => {
    let dnsCalls = 0;
    await assertHostnameSafe("8.8.8.8", {
      resolve: async () => {
        dnsCalls++;
        return [];
      },
    });
    expect(dnsCalls).toBe(0);
  });

  it("blocks the AWS metadata literal without DNS", async () => {
    await expect(
      assertHostnameSafe("169.254.169.254", {
        resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks an IPv6 loopback literal", async () => {
    await expect(assertHostnameSafe("[::1]", { resolve: async () => [] })).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it("resolves hostnames and accepts public addresses", async () => {
    await assertHostnameSafe("example.com", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    });
  });

  it("blocks when a resolved address is private", async () => {
    await expect(
      assertHostnameSafe("evil.example", {
        resolve: async () => [{ address: "10.0.0.1", family: 4 }],
      }),
    ).rejects.toThrow(/ipv4 range/);
  });

  it("blocks when ANY resolved address is private (mixed answers)", async () => {
    await expect(
      assertHostnameSafe("rebound.example", {
        resolve: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects when DNS returns no addresses", async () => {
    await expect(assertHostnameSafe("nx.example", { resolve: async () => [] })).rejects.toThrow(
      /no addresses/,
    );
  });

  it("rejects when DNS lookup throws", async () => {
    await expect(
      assertHostnameSafe("nx.example", {
        resolve: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/dns lookup failed/);
  });
});
