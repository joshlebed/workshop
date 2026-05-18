import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateWebhookSlug,
  hmacSha256Verifier,
  type WebhookRequest,
} from "./webhookSignature.js";

function sign(body: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function req(body: string, headers: Record<string, string>): WebhookRequest {
  return {
    rawBody: Buffer.from(body, "utf8"),
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  };
}

describe("hmacSha256Verifier", () => {
  const SECRET = "shared-secret-with-32+-chars-xxxxxxx";
  const verifier = hmacSha256Verifier({
    scheme: "test",
    signatureHeader: "x-test-signature",
  });

  it("accepts a correctly signed request", () => {
    const body = JSON.stringify({ event: "ping" });
    const sig = sign(Buffer.from(body), SECRET);
    const r = req(body, { "X-Test-Signature": sig });
    expect(verifier.verify(r, SECRET)).toBe(true);
  });

  it("rejects when the signature header is missing", () => {
    const body = JSON.stringify({ event: "ping" });
    const r = req(body, {});
    expect(verifier.verify(r, SECRET)).toBe(false);
  });

  it("rejects on a wrong signature", () => {
    const r = req("{}", { "X-Test-Signature": "deadbeef".repeat(8) });
    expect(verifier.verify(r, SECRET)).toBe(false);
  });

  it("rejects on a flipped byte in the body (signature mismatches)", () => {
    const body = JSON.stringify({ event: "ping" });
    const sig = sign(Buffer.from(body), SECRET);
    const tampered = JSON.stringify({ event: "PONG" });
    const r = req(tampered, { "X-Test-Signature": sig });
    expect(verifier.verify(r, SECRET)).toBe(false);
  });

  it("rejects on a different secret", () => {
    const body = JSON.stringify({ event: "ping" });
    const sig = sign(Buffer.from(body), "other-secret-string-other-secret-x");
    const r = req(body, { "X-Test-Signature": sig });
    expect(verifier.verify(r, SECRET)).toBe(false);
  });

  it("strips a signature header prefix when configured (GitHub-style)", () => {
    const ghVerifier = hmacSha256Verifier({
      scheme: "github",
      signatureHeader: "x-hub-signature-256",
      headerPrefix: "sha256=",
    });
    const body = "ping";
    const sig = sign(Buffer.from(body), SECRET);
    const r = req(body, { "x-hub-signature-256": `sha256=${sig}` });
    expect(ghVerifier.verify(r, SECRET)).toBe(true);
  });

  it("rejects when the prefix doesn't match", () => {
    const ghVerifier = hmacSha256Verifier({
      scheme: "github",
      signatureHeader: "x-hub-signature-256",
      headerPrefix: "sha256=",
    });
    const body = "ping";
    const sig = sign(Buffer.from(body), SECRET);
    // Sent without prefix — verifier expects exactly the configured prefix.
    const r = req(body, { "x-hub-signature-256": sig });
    expect(ghVerifier.verify(r, SECRET)).toBe(false);
  });
});

describe("generateWebhookSlug", () => {
  it("returns a base-36 string of consistent length", () => {
    const slug = generateWebhookSlug();
    expect(/^[a-z0-9]+$/.test(slug)).toBe(true);
    expect(slug.length).toBe(20);
  });

  it("generates distinct slugs (vanishingly small collision probability)", () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 50; i++) slugs.add(generateWebhookSlug());
    expect(slugs.size).toBe(50);
  });
});
