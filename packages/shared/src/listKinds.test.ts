import { describe, expect, it } from "vitest";
import { ITEM_KIND_NAMES } from "./itemKinds";
import {
  featureCopy,
  isFeatureOffered,
  isSyncSourceOffered,
  LIST_KINDS,
  type ListKindKey,
  listKind,
  listKindKey,
  resolveListModules,
  SYNC_SOURCE_COPY,
  SYNC_SOURCE_KINDS,
  sourceDisplayName,
  TOGGLE_FEATURES,
} from "./listKinds";
import { MODULE_NAMES } from "./modules";
import { SOURCE_KINDS } from "./sourceKinds";
import { LIST_TEMPLATES } from "./templates";

const KINDS = Object.keys(LIST_KINDS) as ListKindKey[];

describe("list kind registry", () => {
  it("has a profile for every item kind plus blank", () => {
    expect(KINDS.sort()).toEqual([...ITEM_KIND_NAMES, "blank"].sort());
    for (const k of KINDS) expect(LIST_KINDS[k].key).toBe(k);
  });

  it("reads NULL and unknown kinds as blank", () => {
    expect(listKindKey(null)).toBe("blank");
    expect(listKindKey(undefined)).toBe("blank");
    expect(listKindKey("game")).toBe("blank");
    expect(listKindKey("toString")).toBe("blank");
    expect(listKind("movie").label).toBe("Movies");
  });

  it("offers check-off and the ranked section everywhere, Letterboxd match only on movies", () => {
    for (const k of KINDS) {
      expect(isFeatureOffered(k, "todo")).toBe(true);
      expect(isFeatureOffered(k, "ranking")).toBe(true);
      expect(isFeatureOffered(k, "letterboxd")).toBe(k === "movie");
      expect(isFeatureOffered(k, "sources")).toBe(false);
      expect(isFeatureOffered(k, "leaderboard")).toBe(false);
    }
  });

  it("lists a sync source only where the source registry produces that kind", () => {
    for (const k of KINDS) {
      for (const s of LIST_KINDS[k].syncSources) {
        expect(SOURCE_KINDS[s].producesItemKind).toBe(k);
      }
    }
    for (const s of SYNC_SOURCE_KINDS) {
      const kind = SOURCE_KINDS[s].producesItemKind;
      expect(isSyncSourceOffered(kind, s)).toBe(true);
    }
    expect(isSyncSourceOffered("plain", "spotify_playlist")).toBe(false);
    expect(isSyncSourceOffered("movie", "letterboxd_match")).toBe(false);
    expect(isSyncSourceOffered(null, "letterboxd_list")).toBe(false);
  });

  it("makes source-fed kinds without manual add sync-only and skips Paste many there", () => {
    expect(LIST_KINDS.spotify_album.add.mode).toBe("sync_only");
    expect(LIST_KINDS.spotify_album.add.bulk).toBe(false);
    for (const k of KINDS) {
      if (LIST_KINDS[k].add.mode === "sync_only") expect(LIST_KINDS[k].syncSources.length).toBe(1);
    }
  });

  it("names every toggle in the list's own words", () => {
    expect(featureCopy("movie", "todo")).toEqual({
      label: "Mark watched",
      description: "Ticked films move to a Watched section.",
    });
    expect(featureCopy("book", "todo").label).toBe("Mark read");
    expect(featureCopy("link", "todo").label).toBe("Mark tried");
    expect(featureCopy("spotify_album", "todo").label).toBe("Mark listened");
    expect(featureCopy("plain", "todo").label).toBe("Check things off");
    expect(featureCopy(null, "todo").description).toBe("Ticked items move to a Done section.");
    expect(featureCopy("tv", "ranking").label).toBe("Ranked section");
    expect(featureCopy("tv", "ranking").description).toBe(
      "Number your top shows above the rest. Dragging works either way.",
    );
    expect(featureCopy("movie", "letterboxd").label).toBe("Letterboxd match");
    for (const k of KINDS) {
      for (const f of TOGGLE_FEATURES) {
        const copy = featureCopy(k, f);
        expect(copy.label.length).toBeGreaterThan(0);
        // No em dashes in UI copy (DESIGN.md).
        expect(copy.description).not.toMatch(/—/);
      }
    }
  });

  it("names every source", () => {
    expect(sourceDisplayName("spotify_playlist")).toBe("Spotify playlist");
    expect(sourceDisplayName("letterboxd_list")).toBe("Letterboxd list");
    expect(sourceDisplayName("letterboxd_match")).toBe("Members' Letterboxd watchlists");
    expect(sourceDisplayName("mystery")).toBe("Linked list");
    expect(SYNC_SOURCE_COPY.spotify_playlist.connect).toBe("Connect a Spotify playlist");
  });

  it("keeps its module order in step with MODULE_NAMES", () => {
    const all = resolveListModules({
      itemKind: "movie",
      requested: [...MODULE_NAMES].reverse(),
      syncSourceCount: 1,
    });
    expect(all.modules).toEqual([...MODULE_NAMES]);
  });

  it("only offers the template defaults the registry allows", () => {
    for (const t of LIST_TEMPLATES) {
      for (const m of t.defaults.modules) {
        expect(isFeatureOffered(t.defaults.itemKind, m)).toBe(true);
      }
      if (t.requiresSource) {
        expect(isSyncSourceOffered(t.defaults.itemKind, t.requiresSource.kind)).toBe(true);
      }
    }
  });
});

describe("resolveListModules", () => {
  it("drops a requested sources and derives it from attached sources", () => {
    expect(
      resolveListModules({ itemKind: "plain", requested: ["todo", "sources"], syncSourceCount: 0 }),
    ).toEqual({ modules: ["todo"], notOffered: [] });
    expect(
      resolveListModules({ itemKind: "spotify_album", requested: ["ranking"], syncSourceCount: 1 }),
    ).toEqual({ modules: ["ranking", "sources"], notOffered: [] });
  });

  it("turns sources on with Letterboxd match, which owns its own source", () => {
    expect(
      resolveListModules({ itemKind: "movie", requested: ["letterboxd"], syncSourceCount: 0 })
        .modules,
    ).toEqual(["sources", "letterboxd"]);
  });

  it("reports a newly requested feature the kind does not offer", () => {
    expect(
      resolveListModules({
        itemKind: "plain",
        requested: ["todo", "letterboxd"],
        current: ["todo"],
        syncSourceCount: 0,
      }),
    ).toEqual({ modules: ["todo"], notOffered: ["letterboxd"] });
    expect(
      resolveListModules({ itemKind: null, requested: ["letterboxd"], syncSourceCount: 0 })
        .notOffered,
    ).toEqual(["letterboxd"]);
  });

  it("keeps an unoffered feature the list already has", () => {
    expect(
      resolveListModules({
        itemKind: "book",
        requested: ["todo", "letterboxd"],
        current: ["letterboxd"],
        syncSourceCount: 0,
      }),
    ).toEqual({ modules: ["todo", "letterboxd"], notOffered: [] });
  });

  it("passes leaderboard through and ignores unknown strings", () => {
    expect(
      resolveListModules({
        itemKind: "link",
        requested: ["leaderboard", "bogus"],
        syncSourceCount: 0,
      }).modules,
    ).toEqual(["leaderboard"]);
  });
});
