import type { Item, ListSummary } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import {
  type DetectedSharedScoreKind,
  detectSharedScore,
  flattenListItems,
  isResultlessShare,
  pickSuggestedScoreTarget,
} from "./shareScoreDetection";

describe("detectSharedScore", () => {
  it("ignores non-score share text", () => {
    expect(detectSharedScore("https://example.com/movie")).toBeNull();
    expect(detectSharedScore("")).toBeNull();
    expect(detectSharedScore(null)).toBeNull();
    expect(detectSharedScore("just some text with numbers 42")).toBeNull();
  });

  // Fixtures sampled from prod `item_scores` on 2026-05-19.
  it.each<{ name: string; kind: DetectedSharedScoreKind; raw: string }>([
    {
      name: "MapTap (final score)",
      kind: "maptap",
      raw: "www.maptap.gg May 18\n96🔥 95🏅 99🎯 96🔥 93👑\nFinal score: 956",
    },
    {
      name: "Daily Tens (DailyTens #N + 🏆/❌ grid)",
      kind: "dailytens",
      raw: "DailyTens #742\n\n     🏆    ❌\n     🏆    ❌\n     🏆    ❌\n     ❌    ❌\n     🏆    🏆",
    },
    {
      name: "Globle (#globle hashtag)",
      kind: "globle",
      raw: "🌎 May 19, 2026 🌍\n🔥 1 | Avg. Guesses: 6.04\n⬜⬜🟧🟥🟩 = 5\n\nhttps://globle-game.com\n#globle",
    },
    {
      name: "Satle (🛰Satle #N X/6)",
      kind: "satle",
      raw: "🛰Satle #387 6/6\n🟥🟥🟥🟥🟥🟥\nhttps://satle.ca",
    },
    {
      name: "travle (#travle #N +M)",
      kind: "travle",
      raw: "#travle #1252 +1\n🟧✅✅✅\nhttps://travle.earth",
    },
  ])("detects $name", ({ kind, raw }) => {
    const detection = detectSharedScore(raw);
    expect(detection?.kind).toBe(kind);
    expect(detection?.scoreRaw).toBe(raw);
  });

  // Patterns we add proactively for popular games not yet in prod data.
  it.each<{ name: string; kind: DetectedSharedScoreKind; raw: string }>([
    {
      name: "Wordle",
      kind: "wordle",
      raw: "Wordle 1,127 3/6\n\n⬜⬜🟩🟩🟩\n🟨🟩🟩🟩🟩\n🟩🟩🟩🟩🟩",
    },
    {
      name: "Connections",
      kind: "connections",
      raw: "Connections\nPuzzle #312\n🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪",
    },
    {
      name: "Strands",
      kind: "strands",
      raw: "Strands #112\n“Today's theme”\n🔵🔵🟡🔵\n🔵🔵🔵🔵",
    },
    {
      name: "Worldle",
      kind: "worldle",
      raw: "#Worldle #842 3/6 (100%)\n🟩🟩🟩🟩🟨⬅️\n🟩🟩🟩🟩🟨⬅️\n🟩🟩🟩🟩🟩🎉",
    },
    {
      name: "Tradle (tradle.net domain)",
      kind: "tradle",
      raw: "#Tradle #1547 1/6\n🟩🟩🟩🟩🟩\nhttps://tradle.net/",
    },
    {
      name: "Framed",
      kind: "framed",
      raw: "Framed #998\n🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛\nhttps://framed.wtf",
    },
    {
      name: "Heardle",
      kind: "heardle",
      raw: "#Heardle #515\n\n🔇🔇🔇🟩⬛⬛\n\nhttps://heardle.app",
    },
    {
      name: "NYT Mini",
      kind: "nyt-mini",
      raw: "I solved The Mini in 0:42!\nhttps://www.nytimes.com/badges/games/mini.html",
    },
    {
      name: "Spelling Bee",
      kind: "spelling-bee",
      raw: "I just hit Genius on Spelling Bee.\nhttps://www.nytimes.com/puzzles/spelling-bee",
    },
  ])("detects $name", ({ kind, raw }) => {
    expect(detectSharedScore(raw)?.kind).toBe(kind);
  });

  it("disambiguates Worldle (geography) from Wordle (the 5-letter game)", () => {
    expect(detectSharedScore("#Worldle #842 3/6 (100%)")?.kind).toBe("worldle");
    expect(detectSharedScore("Wordle 1,127 3/6")?.kind).toBe("wordle");
  });

  it("does not match a bare 'wordle' word with no score signature", () => {
    expect(detectSharedScore("I love wordle so much")).toBeNull();
  });
});

describe("isResultlessShare", () => {
  it("treats a bare game referral URL as resultless", () => {
    // The exact prod payload that rendered as "Played": Daily Tens' grid was
    // dropped at the iOS share sheet, leaving only the referral link.
    expect(isResultlessShare("https://dailytens.com/?ref=944415")).toBe(true);
  });

  it("treats empty / whitespace / null as resultless", () => {
    expect(isResultlessShare("")).toBe(true);
    expect(isResultlessShare("   \n  ")).toBe(true);
    expect(isResultlessShare(null)).toBe(true);
    expect(isResultlessShare(undefined)).toBe(true);
  });

  it("treats a URL plus only hashtag lines as resultless", () => {
    expect(isResultlessShare("https://globle-game.com\n#globle")).toBe(true);
  });

  it("keeps a real grid share (grid + trailing URL) as postable", () => {
    const raw =
      "DailyTens #756\n\n     🏆    🏆\n     🏆    🏆\n     🏆    🏆\n     🏆    🏆\n     🏆    🏆 https://dailytens.com/?ref=944415";
    expect(isResultlessShare(raw)).toBe(false);
  });

  it("keeps a grid-only share (no URL) as postable", () => {
    const raw =
      "DailyTens #756\n     🏆    🏆\n     🏆    🏆\n     🏆    🏆\n     🏆    🏆\n     🏆    🏆";
    expect(isResultlessShare(raw)).toBe(false);
  });

  it("keeps a MapTap final-score share as postable", () => {
    expect(isResultlessShare("www.maptap.gg June 1\n99🎯\nFinal score: 865")).toBe(false);
  });
});

describe("pickSuggestedScoreTarget", () => {
  it("picks the most recently updated matching game from leaderboard lists", () => {
    const oldList = makeList("list-old", "Older games", "2026-05-10T12:00:00.000Z");
    const newList = makeList("list-new", "Newer games", "2026-05-11T12:00:00.000Z");
    const oldItem = makeItem("item-old", oldList.id, "MapTap", "2026-05-12T12:00:00.000Z");
    const newItem = makeItem("item-new", newList.id, "MapTap", "2026-05-13T12:00:00.000Z");

    const target = pickSuggestedScoreTarget(
      detectSharedScore("www.maptap.gg May 19\n100🎯\nFinal score: 970"),
      [oldList, newList],
      { [oldList.id]: [oldItem], [newList.id]: [newItem] },
    );

    expect(target?.list.id).toBe(newList.id);
    expect(target?.item.id).toBe(newItem.id);
  });

  it("does not suggest games from lists without leaderboard enabled", () => {
    const list = makeList("list", "Links", "2026-05-10T12:00:00.000Z", []);
    const item = makeItem("item", list.id, "MapTap", "2026-05-12T12:00:00.000Z");

    expect(
      pickSuggestedScoreTarget(detectSharedScore("maptap.gg final score: 11"), [list], {
        [list.id]: [item],
      }),
    ).toBeNull();
  });

  it("matches an item by url when the title doesn't contain the game name", () => {
    const list = makeList("list", "Games", "2026-05-10T12:00:00.000Z");
    const item = {
      ...makeItem("item", list.id, "My puzzle bookmarks", "2026-05-12T12:00:00.000Z"),
      url: "https://satle.ca",
    } satisfies Item;

    const target = pickSuggestedScoreTarget(
      detectSharedScore("🛰Satle #387 6/6\n🟥🟥🟥🟥🟥🟥\nhttps://satle.ca"),
      [list],
      { [list.id]: [item] },
    );

    expect(target?.item.id).toBe("item");
  });
});

describe("flattenListItems", () => {
  it("preserves ordered, unordered, completed section order", () => {
    const a = makeItem("a", "list", "A", "2026-05-12T12:00:00.000Z");
    const b = makeItem("b", "list", "B", "2026-05-12T12:00:00.000Z");
    const c = makeItem("c", "list", "C", "2026-05-12T12:00:00.000Z");

    expect(
      flattenListItems({ ordered: [a], unordered: [b], completed: [c] }).map((i) => i.id),
    ).toEqual(["a", "b", "c"]);
  });
});

function makeList(
  id: string,
  name: string,
  updatedAt: string,
  modules: ListSummary["modules"] = ["leaderboard"],
): ListSummary {
  return {
    id,
    name,
    emoji: "G",
    color: "sunset",
    description: null,
    coverPhotoUrl: null,
    ownerId: "user",
    itemKind: "link",
    modules,
    shareSlug: "testslug",
    shareVisibility: "join",
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt,
    role: "owner",
    itemCount: 1,
    memberCount: 1,
    unreadCount: 0,
    pinnedAt: null,
    archivedAt: null,
    mutedAt: null,
  };
}

function makeItem(id: string, listId: string, title: string, updatedAt: string): Item {
  return {
    id,
    listId,
    kind: "link",
    title,
    url: null,
    note: null,
    content: {},
    position: null,
    addedBy: "user",
    completed: false,
    completedAt: null,
    completedBy: null,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt,
  };
}
