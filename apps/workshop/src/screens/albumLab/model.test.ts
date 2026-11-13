import type { AlbumLibraryAlbum } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import {
  buildShelves,
  closestAlbums,
  countBy,
  digQueue,
  EMPTY_DIG,
  filterAlbums,
  indexAlbums,
  MAP_WORLD,
  mapLayout,
  similarity,
} from "./model";

function album(id: string, over: Partial<AlbumLibraryAlbum> = {}): AlbumLibraryAlbum {
  return {
    id,
    name: `Album ${id}`,
    artists: ["Artist"],
    year: 2019,
    savedAt: "2021-03-04T05:06:07.000Z",
    albumType: "album",
    trackCount: 10,
    label: null,
    popularity: 50,
    imageUrl: null,
    imageSmallUrl: null,
    spotifyUrl: `https://open.spotify.com/album/${id}`,
    genre: "indie",
    subgenre: "dream pop",
    vibes: ["dreamy", "warm", "nostalgic"],
    energy: 40,
    mood: 60,
    tags: [],
    tagsKnown: true,
    ...over,
  };
}

const library = indexAlbums([
  album("dream1", { artists: ["Beach House"], tags: ["dream pop", "shoegaze"] }),
  album("dream2", { artists: ["Beach House"], year: 2015, savedAt: "2018-01-01T00:00:00.000Z" }),
  album("rap1", {
    genre: "hip-hop",
    subgenre: "trap",
    vibes: ["hype", "dark", "gritty"],
    energy: 85,
    mood: 25,
  }),
  album("rap2", {
    genre: "hip-hop",
    subgenre: "boom bap",
    vibes: ["gritty", "nostalgic", "raw"],
    energy: 60,
    mood: 40,
    year: 1994,
  }),
  album("blank", { genre: null, subgenre: null, vibes: [], energy: null, mood: null }),
]);
const ids = (albums: { id: string }[]) => albums.map((a) => a.id);

describe("filterAlbums", () => {
  it("matches every term against name, artist, genre, vibes and tags", () => {
    expect(ids(filterAlbums(library, "beach"))).toEqual(["dream1", "dream2"]);
    expect(ids(filterAlbums(library, "SHOEGAZE beach"))).toEqual(["dream1"]);
    expect(ids(filterAlbums(library, "gritty hip-hop"))).toEqual(["rap1", "rap2"]);
    expect(filterAlbums(library, "  ")).toBe(library);
  });
});

describe("buildShelves", () => {
  it("groups by genre, biggest shelf first, untagged albums on their own shelf", () => {
    const { shelves, hiddenGroups } = buildShelves(library, "genre", "saved");
    expect(shelves.map((s) => [s.key, s.albums.length])).toEqual([
      ["hip-hop", 2],
      ["indie", 2],
      ["untagged", 1],
    ]);
    expect(hiddenGroups).toBe(0);
  });

  it("puts an album on every vibe shelf it has and sorts within a shelf", () => {
    const { shelves } = buildShelves(library, "vibe", "oldest");
    const nostalgic = shelves.find((s) => s.key === "nostalgic");
    expect(ids(nostalgic?.albums ?? [])).toEqual(["rap2", "dream2", "dream1"]);
  });

  it("orders decades newest first and hides small artist groups", () => {
    expect(buildShelves(library, "decade", "saved").shelves.map((s) => s.key)).toEqual([
      "2010s",
      "1990s",
    ]);
    const artists = buildShelves(library, "artist", "saved");
    expect(artists.shelves.map((s) => [s.key, s.albums.length])).toEqual([["Artist", 3]]);
    expect(artists.hiddenGroups).toBe(1);
  });
});

describe("similarity", () => {
  it("ranks the same genre and vibes above a different genre", () => {
    const [dream1, dream2, rap1] = library;
    if (!dream1 || !dream2 || !rap1) throw new Error("fixture");
    expect(similarity(dream1, dream2)).toBeGreaterThan(similarity(dream1, rap1));
    expect(ids(closestAlbums(dream1, library, 1))).toEqual(["dream2"]);
  });

  it("does not treat two untagged albums as sharing a genre", () => {
    const [a, b] = indexAlbums([
      album("x", { genre: null, subgenre: null, vibes: [] }),
      album("y", { genre: null, subgenre: null, vibes: [] }),
    ]);
    if (!a || !b) throw new Error("fixture");
    expect(similarity(a, b)).toBe(0.5);
  });
});

describe("digQueue", () => {
  it("starts with the albums matching the chosen vibes", () => {
    const queue = digQueue(library, { ...EMPTY_DIG, vibes: ["gritty"] }, []);
    expect(ids(queue).slice(0, 2).sort()).toEqual(["rap1", "rap2"]);
  });

  it("leaves out the seed, seen albums and albums already picked", () => {
    const queue = digQueue(library, { ...EMPTY_DIG, seedId: "dream1", seen: ["rap1"] }, ["rap2"]);
    expect(ids(queue)).toEqual(["dream2", "blank"]);
  });

  it("follows what was kept", () => {
    const queue = digQueue(library, { ...EMPTY_DIG, seen: ["rap1"], kept: ["rap1"] }, []);
    expect(queue[0]?.id).toBe("rap2");
  });

  it("limits a rediscover dig to albums saved before the year", () => {
    expect(ids(digQueue(library, { ...EMPTY_DIG, savedBeforeYear: 2020 }, []))).toEqual(["dream2"]);
  });
});

describe("countBy", () => {
  it("counts a facet, most common first", () => {
    expect(countBy(library, (a) => a.vibes).slice(0, 2)).toEqual([
      { key: "nostalgic", count: 3 },
      { key: "dreamy", count: 2 },
    ]);
  });
});

describe("mapLayout", () => {
  it("keeps every tile inside the world, apart from each other, and is deterministic", () => {
    const many = indexAlbums(
      Array.from({ length: 300 }, (_, i) =>
        album(`m${i}`, { energy: 50 + (i % 3), mood: 50 + (i % 2) }),
      ),
    );
    const points = mapLayout(many, "mood", "energy");
    expect(points).toEqual(mapLayout(many, "mood", "energy"));
    const half = MAP_WORLD.tile / 2;
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(half);
      expect(p.x).toBeLessThanOrEqual(MAP_WORLD.width - half);
      expect(p.y).toBeGreaterThanOrEqual(half);
      expect(p.y).toBeLessThanOrEqual(MAP_WORLD.height - half);
    }
    let overlaps = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < MAP_WORLD.tile * 0.8) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it("puts brighter albums to the right and more intense ones higher", () => {
    const two = indexAlbums([
      album("low", { mood: 5, energy: 5 }),
      album("high", { mood: 95, energy: 95 }),
    ]);
    const [low, high] = mapLayout(two, "mood", "energy");
    if (!low || !high) throw new Error("fixture");
    expect(high.x).toBeGreaterThan(low.x);
    expect(high.y).toBeLessThan(low.y);
  });
});
