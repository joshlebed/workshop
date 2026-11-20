import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { callerIp, callerIpKey } from "./clientIp.js";

const app = new Hono().get("/", (c) => c.json({ ip: callerIp(c), key: callerIpKey(c) }));

async function seen(headers: Record<string, string>, sourceIp?: string, socket?: string) {
  const env = {
    ...(sourceIp ? { event: { requestContext: { http: { sourceIp } } } } : {}),
    ...(socket ? { incoming: { socket: { remoteAddress: socket } } } : {}),
  };
  const res = await app.request("http://api.test/", { headers }, env);
  return (await res.json()) as { ip: string | null; key: string };
}

describe("callerIp", () => {
  it("uses the address the gateway saw and ignores X-Forwarded-For", async () => {
    const out = await seen({ "X-Forwarded-For": "203.0.113.77, 198.51.100.4" }, "198.51.100.4");
    expect(out.ip).toBe("198.51.100.4");
  });

  it("does not believe the proxy header from a connection outside Cloudflare", async () => {
    const out = await seen({ "X-Workshop-Client-Ip": "203.0.113.77" }, "198.51.100.4");
    expect(out.ip).toBe("198.51.100.4");
  });

  it("believes the proxy header when the connection came from Cloudflare", async () => {
    expect((await seen({ "X-Workshop-Client-Ip": "203.0.113.77" }, "172.71.10.9")).ip).toBe(
      "203.0.113.77",
    );
    expect((await seen({ "X-Workshop-Client-Ip": "2001:db8::1" }, "2a06:98c0:3600::103")).ip).toBe(
      "2001:db8::1",
    );
  });

  it("falls back to the Cloudflare address when the proxy header is missing or not an address", async () => {
    expect((await seen({}, "172.71.10.9")).ip).toBe("172.71.10.9");
    expect((await seen({ "X-Workshop-Client-Ip": "not-an-ip" }, "172.71.10.9")).ip).toBe(
      "172.71.10.9",
    );
  });

  it("reads the socket address under the local Node server, unmapping IPv4", async () => {
    expect((await seen({}, undefined, "::ffff:127.0.0.1")).ip).toBe("127.0.0.1");
  });

  it("has no address, and one shared key, when the runtime gives none", async () => {
    expect(await seen({ "X-Forwarded-For": "203.0.113.77" })).toEqual({ ip: null, key: "unknown" });
  });
});
