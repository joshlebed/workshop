import { beforeEach, describe, expect, it } from "vitest";
import { buildApp, isAllowedOrigin } from "./app.js";
import { resetConfigForTesting } from "./lib/config.js";

function setEnv() {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.AWS_REGION = "us-east-1";
  process.env.LOG_LEVEL = "error";
  resetConfigForTesting();
}

describe("isAllowedOrigin", () => {
  it("allows the production web origin", () => {
    expect(isAllowedOrigin("https://workshop-a2v.pages.dev")).toBe(true);
  });

  it("allows Cloudflare Pages branch previews", () => {
    expect(isAllowedOrigin("https://feature-x.workshop-a2v.pages.dev")).toBe(true);
    expect(isAllowedOrigin("https://abc123.workshop-a2v.pages.dev")).toBe(true);
  });

  it("allows localhost dev origins", () => {
    expect(isAllowedOrigin("http://localhost:8081")).toBe(true);
    expect(isAllowedOrigin("http://localhost:8787")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8081")).toBe(true);
  });

  it("rejects arbitrary attacker origins", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedOrigin("https://workshop-a2v.pages.dev.evil.com")).toBe(false);
    expect(isAllowedOrigin("http://workshop-a2v.pages.dev")).toBe(false);
    expect(isAllowedOrigin("https://workshop-a2vXpages.dev")).toBe(false);
  });

  it("rejects subdomain-injection lookalikes", () => {
    expect(isAllowedOrigin("https://x.workshop-a2v.pages.dev.evil.com")).toBe(false);
    expect(isAllowedOrigin("https://workshop-a2v.pages.dev@evil.com")).toBe(false);
  });
});

describe("CORS middleware", () => {
  beforeEach(setEnv);

  it("echoes an allowed origin on preflight", async () => {
    const app = buildApp();
    const res = await app.request("/v1/lists", {
      method: "OPTIONS",
      headers: {
        Origin: "https://workshop-a2v.pages.dev",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://workshop-a2v.pages.dev");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not echo a disallowed origin on preflight", async () => {
    const app = buildApp();
    const res = await app.request("/v1/lists", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not reflect an arbitrary origin on a real request", async () => {
    const app = buildApp();
    const res = await app.request("/", {
      method: "GET",
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
