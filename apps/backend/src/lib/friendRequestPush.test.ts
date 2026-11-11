import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendExpoPushMessages, getDb } = vi.hoisted(() => ({
  sendExpoPushMessages: vi.fn(),
  getDb: vi.fn(),
}));
vi.mock("./expoPush.js", () => ({ sendExpoPushMessages }));
vi.mock("../db/client.js", () => ({ getDb }));

import { buildFriendRequestPushMessages, sendFriendRequestPush } from "./friendRequestPush.js";

describe("buildFriendRequestPushMessages", () => {
  it("builds one message per token naming the inviter, with a routable data payload", () => {
    const messages = buildFriendRequestPushMessages({ id: "u-1", displayName: "Josh" }, [
      "tok-a",
      "tok-b",
    ]);
    expect(messages).toEqual([
      {
        to: "tok-a",
        title: "New friend request",
        body: "Josh wants to be friends on HighScore",
        data: { kind: "friend_request", userId: "u-1" },
        sound: "default",
      },
      {
        to: "tok-b",
        title: "New friend request",
        body: "Josh wants to be friends on HighScore",
        data: { kind: "friend_request", userId: "u-1" },
        sound: "default",
      },
    ]);
  });

  it("says 'Someone' for a missing or blank display name", () => {
    for (const displayName of [null, "", "   "]) {
      const [message] = buildFriendRequestPushMessages({ id: "u-1", displayName }, ["tok"]);
      expect(message?.body).toBe("Someone wants to be friends on HighScore");
    }
  });

  it("trims the display name", () => {
    const [message] = buildFriendRequestPushMessages({ id: "u-1", displayName: "  Ann " }, ["t"]);
    expect(message?.body).toBe("Ann wants to be friends on HighScore");
  });

  it("returns nothing without tokens", () => {
    expect(buildFriendRequestPushMessages({ id: "u-1", displayName: "Josh" }, [])).toEqual([]);
  });
});

describe("sendFriendRequestPush", () => {
  beforeEach(() => {
    // The failure path logs, and the logger reads config.
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    sendExpoPushMessages.mockReset();
    getDb.mockReset();
  });

  it("never throws when the DB lookup fails", async () => {
    getDb.mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(sendFriendRequestPush("a", "b")).resolves.toBeUndefined();
    expect(sendExpoPushMessages).not.toHaveBeenCalled();
  });
});
