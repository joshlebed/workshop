import type { ActivityEvent, ListSummary } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import { homeRowCount, homeRowSubtitle, matchesListSearch } from "./homeRow";

const now = new Date("2026-11-12T12:00:00Z").getTime();

function list(partial: Partial<ListSummary>): ListSummary {
  return {
    id: "l1",
    name: "Movies",
    emoji: "🎬",
    color: "sunset",
    description: "a long description that must not appear",
    coverPhotoUrl: null,
    ownerId: "me",
    itemKind: "movie",
    modules: ["todo"],
    shareSlug: "s",
    shareVisibility: "join",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-10-29T12:00:00Z",
    role: "owner",
    itemCount: 14,
    openItemCount: 12,
    memberCount: 2,
    unreadCount: 0,
    pinnedAt: null,
    archivedAt: null,
    mutedAt: null,
    ...partial,
  };
}

const event = (p: Partial<ActivityEvent>): ActivityEvent => ({
  id: "e",
  listId: "l1",
  actorId: "renata",
  actorDisplayName: "Renata Hoh",
  type: "item_added",
  itemId: "i",
  payload: { title: "Past Lives" },
  createdAt: "2026-11-10T12:00:00Z",
  ...p,
});

describe("homeRowCount", () => {
  it("counts open items in the list's own word when it has to-do", () => {
    expect(homeRowCount(list({}))).toBe("12 to watch");
    expect(homeRowCount(list({ itemKind: "book", openItemCount: 1 }))).toBe("1 to read");
    expect(homeRowCount(list({ itemKind: "plain", openItemCount: 3 }))).toBe("3 to do");
    expect(homeRowCount(list({ openItemCount: 0 }))).toBe("All watched");
  });

  it("uses the plain noun without to-do, and Empty for nothing", () => {
    expect(homeRowCount(list({ modules: [], itemCount: 4, itemKind: "spotify_album" }))).toBe(
      "4 albums",
    );
    expect(homeRowCount(list({ modules: [], itemCount: 1, itemKind: "movie" }))).toBe("1 film");
    expect(homeRowCount(list({ modules: [], itemCount: 9, itemKind: null }))).toBe("9 items");
    expect(homeRowCount(list({ itemCount: 0, openItemCount: 0 }))).toBe("Empty");
  });

  it("falls back to the total for a cached response without openItemCount", () => {
    expect(homeRowCount(list({ openItemCount: undefined }))).toBe("14 to watch");
  });
});

describe("homeRowSubtitle (one rule for every row)", () => {
  it("count · who did what · age", () => {
    expect(homeRowSubtitle(list({}), event({}), "me", now)).toBe(
      "12 to watch · Renata added Past Lives · 2d",
    );
  });

  it("says You for the viewer and the completion word for the list", () => {
    expect(
      homeRowSubtitle(list({}), event({ actorId: "me", type: "item_completed" }), "me", now),
    ).toBe("12 to watch · You watched Past Lives · 2d");
  });

  it("shortens a long item title so the age stays on the line", () => {
    expect(
      homeRowSubtitle(
        list({}),
        event({ payload: { title: "Upstate cabin trip with friends and a lake" } }),
        "me",
        now,
      ),
    ).toBe("12 to watch · Renata added Upstate cabin trip wi… · 2d");
  });

  it("without a recent event: count · updated age (never the description)", () => {
    expect(homeRowSubtitle(list({}), null, "me", now)).toBe("12 to watch · updated 2w");
  });
});

describe("matchesListSearch", () => {
  it("matches names case- and accent-insensitively", () => {
    expect(matchesListSearch("Café ideas", "cafe")).toBe(true);
    expect(matchesListSearch("Movies", "MOV")).toBe(true);
    expect(matchesListSearch("Movies", "books")).toBe(false);
    expect(matchesListSearch("Movies", "  ")).toBe(true);
  });
});
