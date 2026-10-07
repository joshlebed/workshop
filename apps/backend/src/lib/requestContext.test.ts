import { describe, expect, it } from "vitest";
import {
  describeRequestClient,
  getRequestClientContext,
  requestClientContextFromHeaders,
  runWithRequestClientContext,
} from "./requestContext.js";

function headers(map: Record<string, string>) {
  return (name: string) => map[name.toLowerCase()];
}

describe("requestClientContextFromHeaders", () => {
  it("reads the three client headers case-insensitively", () => {
    expect(
      requestClientContextFromHeaders(
        headers({
          "x-workshop-client": "highscore",
          "x-workshop-platform": "ios",
          "x-workshop-app-version": "1.4.0",
        }),
      ),
    ).toEqual({ client: "highscore", platform: "ios", appVersion: "1.4.0" });
  });

  it("drops an unknown client value and blanks", () => {
    expect(
      requestClientContextFromHeaders(
        headers({ "x-workshop-client": "evil", "x-workshop-platform": "  " }),
      ),
    ).toEqual({ client: null, platform: null, appVersion: null });
  });
});

describe("describeRequestClient", () => {
  it("formats app · platform version", () => {
    expect(
      describeRequestClient({ client: "highscore", platform: "ios", appVersion: "1.4.0" }),
    ).toBe("HighScore · iOS 1.4.0");
    expect(
      describeRequestClient({ client: "workshop", platform: "web", appVersion: "0.9.2" }),
    ).toBe("Workshop · web 0.9.2");
  });

  it("labels a pre-header client as unknown app but keeps platform/version", () => {
    expect(describeRequestClient({ client: null, platform: "ios", appVersion: "0.3.0" })).toBe(
      "unknown app · iOS 0.3.0",
    );
  });

  it("returns null when nothing is known (webhooks, curl, bots)", () => {
    expect(describeRequestClient({ client: null, platform: null, appVersion: null })).toBeNull();
    expect(describeRequestClient(null)).toBeNull();
    expect(describeRequestClient()).toBeNull();
  });
});

describe("runWithRequestClientContext", () => {
  it("exposes the context across awaits inside the run and not outside", async () => {
    const ctx = { client: "workshop" as const, platform: "web", appVersion: "1.0.0" };
    const seen = await runWithRequestClientContext(ctx, async () => {
      await Promise.resolve();
      return getRequestClientContext();
    });
    expect(seen).toEqual(ctx);
    expect(getRequestClientContext()).toBeNull();
  });
});
