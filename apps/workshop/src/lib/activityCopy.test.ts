import type { ActivityEvent } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import {
  describeActivity,
  firstName,
  newEventIds,
  shortAge,
  splitAtReadMarker,
} from "./activityCopy";

let seq = 0;
function ev(partial: Partial<ActivityEvent>): ActivityEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    listId: "l1",
    actorId: "other",
    actorDisplayName: "Renata Hoh",
    type: "item_added",
    itemId: null,
    payload: {},
    createdAt: new Date(2026, 10, 12, 12, 0, 60 - seq).toISOString(),
    ...partial,
  };
}

describe("describeActivity (glossary verbs)", () => {
  const t = { title: "Past Lives" };
  it("says deleted, not archived, for items and lists", () => {
    expect(describeActivity(ev({ type: "item_archived", payload: t }), { quote: true })).toBe(
      "deleted “Past Lives”",
    );
    expect(describeActivity(ev({ type: "list_archived" }))).toBe("deleted the list");
  });

  it("says moved for every change of place, old ranked-section events included", () => {
    expect(describeActivity(ev({ type: "item_promoted", payload: t }))).toBe("moved Past Lives");
    expect(describeActivity(ev({ type: "item_demoted", payload: t }))).toBe("moved Past Lives");
    expect(describeActivity(ev({ type: "module_enabled", payload: { module: "ranking" } }))).toBe(
      "turned on numbering",
    );
  });

  it("uses the list's own completion word", () => {
    const done = ev({ type: "item_completed", payload: t });
    expect(describeActivity(done, { kind: "movie" })).toBe("watched Past Lives");
    expect(describeActivity(done, { kind: "book" })).toBe("read Past Lives");
    expect(describeActivity(done, { kind: "plain" })).toBe("marked Past Lives done");
    expect(describeActivity(done, { kind: "spotify_album" })).toBe("listened to Past Lives");
    expect(
      describeActivity(ev({ type: "item_uncompleted", payload: t }), { kind: "spotify_album" }),
    ).toBe("marked Past Lives not listened");
    expect(describeActivity(ev({ type: "item_uncompleted", payload: t }), { kind: "tv" })).toBe(
      "marked Past Lives not watched",
    );
  });

  it("names features and sources plainly", () => {
    expect(describeActivity(ev({ type: "module_enabled", payload: { module: "todo" } }))).toBe(
      "turned on to-do",
    );
    expect(
      describeActivity(ev({ type: "source_added", payload: { kind: "spotify_playlist" } })),
    ).toBe("started syncing from a Spotify playlist");
    expect(describeActivity(ev({ type: "source_synced", payload: { addedCount: 2 } }))).toBe(
      "synced 2 new items",
    );
  });

  it("never says archived, pinned, checked off, uncrossed or module", () => {
    const types: ActivityEvent["type"][] = [
      "list_created",
      "list_archived",
      "list_duplicated",
      "member_joined",
      "member_left",
      "member_removed",
      "owner_transferred",
      "item_added",
      "item_updated",
      "item_archived",
      "item_restored",
      "item_tagged",
      "item_completed",
      "item_uncompleted",
      "item_promoted",
      "item_demoted",
      "invite_created",
      "invite_revoked",
      "module_enabled",
      "module_disabled",
      "source_added",
      "source_removed",
      "source_updated",
      "source_synced",
      "item_suggested",
      "suggestion_accepted",
    ];
    for (const type of types) {
      const text = describeActivity(ev({ type, payload: { title: "X", module: "ranking" } }));
      expect(text).not.toMatch(/archiv|pinned|checked off|uncrossed|module|rank|ordered/i);
    }
  });
});

describe("firstName / shortAge", () => {
  it("shortens names and ages", () => {
    expect(firstName("Renata Hoh")).toBe("Renata");
    expect(firstName("  ")).toBe("Someone");
    const now = new Date("2026-11-12T12:00:00Z").getTime();
    expect(shortAge("2026-11-12T11:58:00Z", now)).toBe("2m");
    expect(shortAge("2026-11-10T12:00:00Z", now)).toBe("2d");
    expect(shortAge("2026-10-01T12:00:00Z", now)).toBe("1mo");
  });
});

describe("New divider split", () => {
  it("marks each list's latest unread events by other people", () => {
    const events = [
      ev({ id: "a1", listId: "A" }),
      ev({ id: "s1", listId: "A", actorId: "me" }),
      ev({ id: "b1", listId: "B" }),
      ev({ id: "a2", listId: "A" }),
      ev({ id: "a3", listId: "A" }),
      ev({ id: "b2", listId: "B" }),
    ];
    const ids = newEventIds(
      events,
      new Map([
        ["A", 2],
        ["B", 1],
      ]),
      "me",
    );
    expect([...ids].sort()).toEqual(["a1", "a2", "b1"]);
  });

  it("puts new events first and keeps everything else in order", () => {
    const events = [ev({ id: "x" }), ev({ id: "y" }), ev({ id: "z" })];
    const { fresh, earlier } = splitAtReadMarker(events, new Set(["x", "z"]));
    expect(fresh.map((e) => e.id)).toEqual(["x", "z"]);
    expect(earlier.map((e) => e.id)).toEqual(["y"]);
  });

  it("has nothing new when every list is read (or muted, which reports 0)", () => {
    const ids = newEventIds([ev({ listId: "A" })], new Map([["A", 0]]), "me");
    expect(ids.size).toBe(0);
  });
});
