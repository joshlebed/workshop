import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "./config.js";
import {
  buildContentReportNotification,
  buildDirectionChangedNotification,
  buildFirstScoreNotification,
  buildFriendRequestSentNotification,
  buildFriendshipFormedNotification,
  buildGameAddedNotification,
  buildLetterboxdConnectedNotification,
  buildListArchivedNotification,
  buildListJoinedNotification,
  buildOwnershipTransferredNotification,
  buildParserTaughtNotification,
  buildScoreSpecTaughtNotification,
  buildSessionsRevokedNotification,
  buildSourceWebhookNotification,
  buildUserBlockedNotification,
  opsNotificationsEnabled,
} from "./opsNotifications.js";

describe("ops notification builders", () => {
  it("content report carries the target id, a trimmed snapshot and the runbook", () => {
    const n = buildContentReportNotification("Josh", "Troll", "t-id", "score", "abusive", "a\n b");
    expect(n.kind).toBe("content_report");
    expect(n.content).toContain("Josh reported Troll (a score post, abusive)");
    expect(n.content).toContain('"a b"');
    expect(n.content).toContain("target id t-id");
    expect(n.content).toContain("moderation-runbook");
    expect(
      buildContentReportNotification("A", "B", "id", "profile", "spam", null).content,
    ).toContain("their profile");
  });

  it("user blocked names both sides and the blocked id", () => {
    expect(buildUserBlockedNotification("Josh", "Troll", "t-id")).toEqual({
      content: "⛔ user blocked — Josh blocked Troll · blocked id t-id",
      kind: "user_blocked",
    });
  });

  it("friend request sent", () => {
    expect(buildFriendRequestSentNotification("Josh", "Alex")).toEqual({
      content: "📨 friend request — Josh → Alex",
      kind: "friend_request",
    });
  });

  it("friendship formed names the path taken", () => {
    expect(buildFriendshipFormedNotification("Josh", "Alex", "accepted request")).toEqual({
      content: "🤝 new friendship — Josh ↔ Alex (accepted request)",
      kind: "friend_added",
    });
  });

  it("list joined", () => {
    expect(buildListJoinedNotification("Josh", "Geo games", "share link")).toEqual({
      content: '📥 list joined — Josh joined "Geo games" (share link)',
      kind: "list_joined",
    });
  });

  it("first score", () => {
    expect(buildFirstScoreNotification("Josh", "Wordle")).toEqual({
      content: "🎯 first score — Josh posted their first score (Wordle)",
      kind: "first_score",
    });
  });

  it("letterboxd connected pluralizes the film count", () => {
    expect(buildLetterboxdConnectedNotification("Josh", "joshl", 42).content).toBe(
      "🎬 Letterboxd connected — Josh linked @joshl (42 films)",
    );
    expect(buildLetterboxdConnectedNotification("Josh", "joshl", 1).content).toBe(
      "🎬 Letterboxd connected — Josh linked @joshl (1 film)",
    );
  });

  it("game added", () => {
    expect(buildGameAddedNotification("Josh", "Connections")).toEqual({
      content: '🎮 game added — Josh added "Connections" to My Games',
      kind: "game_added",
    });
  });

  it("score spec taught (first teach)", () => {
    expect(
      buildScoreSpecTaughtNotification("Josh", "Squardle", {
        replacedExisting: false,
        scoreDirection: "asc",
        hasSummarySpec: true,
      }),
    ).toEqual({
      content: '🧑‍🏫 score spec taught — Josh taught "Squardle" (lower is better, with recap trim)',
      kind: "score_spec_taught",
    });
  });

  it("score spec re-taught (replacing an existing config)", () => {
    expect(
      buildScoreSpecTaughtNotification("Alex", "Squardle", {
        replacedExisting: true,
        scoreDirection: "desc",
        hasSummarySpec: false,
      }),
    ).toEqual({
      content: '🧑‍🏫 score spec re-taught — Alex re-taught "Squardle" (higher is better)',
      kind: "score_spec_taught",
    });
  });

  it("sessions revoked", () => {
    expect(buildSessionsRevokedNotification("Josh")).toEqual({
      content: "🔒 all sessions signed out — Josh signed out of every device",
      kind: "sessions_revoked",
    });
  });

  it("list archived", () => {
    expect(buildListArchivedNotification("Josh", "Geo games")).toEqual({
      content: '🗑️ list archived — Josh archived "Geo games"',
      kind: "list_archived",
    });
  });

  it("ownership transferred", () => {
    expect(buildOwnershipTransferredNotification("Geo games", "Josh", "Alex")).toEqual({
      content: '👑 ownership transferred — "Geo games" Josh → Alex',
      kind: "ownership_transferred",
    });
  });

  it("source webhook", () => {
    expect(buildSourceWebhookNotification("abc12345", "rss", 3)).toEqual({
      content: '📡 source webhook — "rss" fired (slug abc12345, +3 items)',
      kind: "source_webhook",
    });
  });
});

describe("opsNotificationsEnabled", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    resetConfigForTesting();
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(48);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetConfigForTesting();
  });

  it("is false when the webhook is unset (skips notify-only DB work)", () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "";
    expect(opsNotificationsEnabled()).toBe(false);
  });

  it("is true when the webhook is configured", () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    expect(opsNotificationsEnabled()).toBe(true);
  });
});

describe("teach v2 notifications", () => {
  const base = {
    gameTitle: "Krillion",
    version: 3,
    example: "Krillion #81 🦐 415 🦑🏮🫧 → 415",
    rowsNewlyRead: 0,
    rowsChanged: 0,
    direction: null,
  } as const;

  it("names who taught which game, the new version, and the example", () => {
    const n = buildParserTaughtNotification("Josh", { ...base, kind: "reteach" });
    expect(n.kind).toBe("parser_taught");
    expect(n.content).toBe(
      '🧑‍🏫 parser re-taught — Josh re-taught "Krillion" → v3\n> Krillion #81 🦐 415 🦑🏮🫧 → 415',
    );
  });

  it("says first teach, direction and how many rows it read", () => {
    const n = buildParserTaughtNotification("Josh", {
      ...base,
      kind: "first",
      version: 1,
      direction: "desc",
      rowsNewlyRead: 4,
    });
    expect(n.content).toContain(
      'Josh taught "Krillion" → v1 (higher is better, 4 unread now read)',
    );
  });

  it("marks a switch after a second user agreed", () => {
    const n = buildParserTaughtNotification("Dag", { ...base, kind: "switch", rowsChanged: 2 });
    expect(n.content).toContain('Dag switched "Krillion" → v3 (2 re-read)');
  });

  it("announces a direction change", () => {
    const n = buildDirectionChangedNotification("Josh", {
      gameTitle: "Krillion",
      from: "desc",
      to: "asc",
    });
    expect(n).toEqual({
      kind: "direction_changed",
      content:
        '↕️ score direction changed — Josh set "Krillion" to lower is better (was higher is better)',
    });
  });
});
