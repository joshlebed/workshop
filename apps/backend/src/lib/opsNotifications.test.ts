import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "./config.js";
import {
  buildFirstScoreNotification,
  buildFriendRequestSentNotification,
  buildFriendshipFormedNotification,
  buildGameAddedNotification,
  buildLetterboxdConnectedNotification,
  buildListArchivedNotification,
  buildListJoinedNotification,
  buildOwnershipTransferredNotification,
  buildScoreSpecTaughtNotification,
  buildSessionsRevokedNotification,
  buildSourceWebhookNotification,
  opsNotificationsEnabled,
} from "./opsNotifications.js";

describe("ops notification builders", () => {
  it("friend request sent", () => {
    expect(buildFriendRequestSentNotification("Josh", "Alex")).toEqual({
      content: ":envelope_with_arrow: friend request — Josh → Alex",
      kind: "friend_request",
    });
  });

  it("friendship formed names the path taken", () => {
    expect(buildFriendshipFormedNotification("Josh", "Alex", "accepted request")).toEqual({
      content: ":handshake: new friendship — Josh ↔ Alex (accepted request)",
      kind: "friend_added",
    });
  });

  it("list joined", () => {
    expect(buildListJoinedNotification("Josh", "Geo games", "share link")).toEqual({
      content: ':inbox_tray: list joined — Josh joined "Geo games" (share link)',
      kind: "list_joined",
    });
  });

  it("first score", () => {
    expect(buildFirstScoreNotification("Josh", "Wordle")).toEqual({
      content: ":dart: first score — Josh posted their first score (Wordle)",
      kind: "first_score",
    });
  });

  it("letterboxd connected pluralizes the film count", () => {
    expect(buildLetterboxdConnectedNotification("Josh", "joshl", 42).content).toBe(
      ":clapper: Letterboxd connected — Josh linked @joshl (42 films)",
    );
    expect(buildLetterboxdConnectedNotification("Josh", "joshl", 1).content).toBe(
      ":clapper: Letterboxd connected — Josh linked @joshl (1 film)",
    );
  });

  it("game added", () => {
    expect(buildGameAddedNotification("Josh", "Connections")).toEqual({
      content: ':video_game: game added — Josh added "Connections" to My Games',
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
      content:
        ':teacher: score spec taught — Josh taught "Squardle" (lower is better, with recap trim)',
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
      content: ':teacher: score spec re-taught — Alex re-taught "Squardle" (higher is better)',
      kind: "score_spec_taught",
    });
  });

  it("sessions revoked", () => {
    expect(buildSessionsRevokedNotification("Josh")).toEqual({
      content: ":lock: all sessions signed out — Josh signed out of every device",
      kind: "sessions_revoked",
    });
  });

  it("list archived", () => {
    expect(buildListArchivedNotification("Josh", "Geo games")).toEqual({
      content: ':wastebasket: list archived — Josh archived "Geo games"',
      kind: "list_archived",
    });
  });

  it("ownership transferred", () => {
    expect(buildOwnershipTransferredNotification("Geo games", "Josh", "Alex")).toEqual({
      content: ':crown: ownership transferred — "Geo games" Josh → Alex',
      kind: "ownership_transferred",
    });
  });

  it("source webhook", () => {
    expect(buildSourceWebhookNotification("abc12345", "rss", 3)).toEqual({
      content: ':satellite: source webhook — "rss" fired (slug abc12345, +3 items)',
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
