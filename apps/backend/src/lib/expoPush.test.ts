import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "./config.js";
import { sendExpoPushMessages } from "./expoPush.js";
import { LOCAL_PUSH_URL } from "./localPush.js";

const message = {
  recipientId: "synthetic-recipient",
  to: "ExpoPushToken[synthetic-token]",
  title: "New friend request",
  body: "A friend sent a request",
  data: { userId: "synthetic-sender" },
};
const category = "friend_request";

beforeEach(() => {
  vi.stubEnv("STAGE", "local");
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  resetConfigForTesting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTesting();
});

describe("local push", () => {
  it.each([
    "https://exp.host/--/api/v2/push/send",
    "http://localhost:9911/push",
    "http://127.0.0.1@example.com/push",
    "https://127.0.0.1/push",
    "invalid",
  ])("fails before the transport for %s even under Vitest", async (url) => {
    vi.stubEnv("EXPO_PUSH_URL", url);
    const fetchFn = vi.fn<typeof fetch>();
    const result = await sendExpoPushMessages([message], { category, fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      sent: 0,
      failed: 1,
      prunedTokens: [],
      outcomes: [{ status: "request_failed" }],
    });
  });

  it("uses the default recorder and excludes tokens and deep-link data", async () => {
    vi.stubEnv("EXPO_PUSH_URL", "");
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [{ status: "ok" }] }));
    const result = await sendExpoPushMessages([message], { category, fetchFn });
    expect(fetchFn).toHaveBeenCalledWith(
      new URL(LOCAL_PUSH_URL),
      expect.objectContaining({
        redirect: "error",
        body: JSON.stringify([
          { category, recipientId: message.recipientId, title: message.title, body: message.body },
        ]),
      }),
    );
    expect(result).toMatchObject({ sent: 1, failed: 0, prunedTokens: [] });
  });

  it("does not prune a stored token if a local endpoint returns an error ticket", async () => {
    vi.stubEnv("EXPO_PUSH_URL", LOCAL_PUSH_URL);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
      }),
    );
    const result = await sendExpoPushMessages([message], { category, fetchFn });
    expect(result).toMatchObject({ sent: 0, failed: 1, prunedTokens: [] });
  });
});
