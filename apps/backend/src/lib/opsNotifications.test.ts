import { describe, expect, it } from "vitest";
import {
  buildFirstScoreNotification,
  buildFriendRequestSentNotification,
  buildFriendshipFormedNotification,
  buildGameAddedNotification,
  buildLetterboxdConnectedNotification,
  buildListArchivedNotification,
  buildListJoinedNotification,
  buildOwnershipTransferredNotification,
  buildSessionsRevokedNotification,
  buildSourceWebhookNotification,
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
