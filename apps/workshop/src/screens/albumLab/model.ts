// Album lab: pure helpers behind the three flows (Shelves, Map, Dig). No React
// and no API here, so everything is unit-tested in model.test.ts.

import type { AlbumLibraryAlbum } from "@workshop/shared";

export type LabAlbum = AlbumLibraryAlbum & {
  /** Lowercased text the search box matches against. */
  hay: string;
};

const UNTAGGED = "untagged";

export function indexAlbums(albums: AlbumLibraryAlbum[]): LabAlbum[] {
  return albums.map((a) => ({
    ...a,
    hay: [
      a.name,
      a.artists.join(" "),
      a.genre,
      a.subgenre,
      a.vibes.join(" "),
      a.tags.join(" "),
      a.year,
      a.label,
    ]
      .filter((part) => part !== null && part !== "")
      .join(" ")
      .toLowerCase(),
  }));
}

export function filterAlbums(albums: LabAlbum[], query: string): LabAlbum[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return albums;
  return albums.filter((a) => terms.every((t) => a.hay.includes(t)));
}

// ---------- genre colors (fixed hues, readable on the dark canvas)

const GENRE_COLORS: Record<string, string> = {
  "hip-hop": "#f2a541",
  "r&b-soul": "#e8618c",
  electronic: "#4fc3f7",
  dance: "#7c8cff",
  ambient: "#7fd8be",
  indie: "#c5e063",
  psych: "#c77dff",
  "dream-pop": "#f7a8d8",
  pop: "#ff7b54",
  rock: "#d9534f",
  heavy: "#8d99ae",
  jazz: "#e9c46a",
  "funk-disco": "#ff9f1c",
  "folk-country": "#a3b18a",
  global: "#2ec4b6",
  "soundtrack-classical": "#b8c0ff",
};

export function genreColor(genre: string | null): string {
  return (genre && GENRE_COLORS[genre]) || "#777777";
}

/** Values of one facet with how many albums carry each, most common first. */
export function countBy(
  albums: LabAlbum[],
  keys: (a: LabAlbum) => string[],
): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of albums) for (const k of keys(a)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key));
}

// ---------- Shelves: grouping and sorting

export const GROUPS = {
  genre: { label: "Genre", keys: (a: LabAlbum) => [a.genre ?? UNTAGGED], min: 1, byKey: false },
  subgenre: {
    label: "Subgenre",
    keys: (a: LabAlbum) => [a.subgenre ?? UNTAGGED],
    min: 4,
    byKey: false,
  },
  vibe: {
    label: "Vibe",
    keys: (a: LabAlbum) => (a.vibes.length ? a.vibes : [UNTAGGED]),
    min: 1,
    byKey: false,
  },
  decade: {
    label: "Decade",
    keys: (a: LabAlbum) => [`${Math.floor(a.year / 10) * 10}s`],
    min: 1,
    byKey: true,
  },
  saved: {
    label: "Year saved",
    keys: (a: LabAlbum) => [a.savedAt.slice(0, 4)],
    min: 1,
    byKey: true,
  },
  artist: {
    label: "Artist",
    keys: (a: LabAlbum) => [a.artists[0] ?? "Unknown"],
    min: 3,
    byKey: false,
  },
} as const;
export type GroupKey = keyof typeof GROUPS;

const mid = (n: number | null) => n ?? 50;

export const SORTS = {
  saved: {
    label: "Recently saved",
    cmp: (a: LabAlbum, b: LabAlbum) => b.savedAt.localeCompare(a.savedAt),
  },
  newest: { label: "Newest release", cmp: (a: LabAlbum, b: LabAlbum) => b.year - a.year },
  oldest: { label: "Oldest release", cmp: (a: LabAlbum, b: LabAlbum) => a.year - b.year },
  artist: {
    label: "Artist A to Z",
    cmp: (a: LabAlbum, b: LabAlbum) =>
      (a.artists[0] ?? "").localeCompare(b.artists[0] ?? "") || a.year - b.year,
  },
  energy: {
    label: "Most energy",
    cmp: (a: LabAlbum, b: LabAlbum) => mid(b.energy) - mid(a.energy),
  },
  calm: { label: "Calmest", cmp: (a: LabAlbum, b: LabAlbum) => mid(a.energy) - mid(b.energy) },
  bright: { label: "Brightest mood", cmp: (a: LabAlbum, b: LabAlbum) => mid(b.mood) - mid(a.mood) },
  dark: { label: "Darkest mood", cmp: (a: LabAlbum, b: LabAlbum) => mid(a.mood) - mid(b.mood) },
  popular: {
    label: "Most popular",
    cmp: (a: LabAlbum, b: LabAlbum) => (b.popularity ?? 0) - (a.popularity ?? 0),
  },
} as const;
export type SortKey = keyof typeof SORTS;

export interface Shelf {
  key: string;
  albums: LabAlbum[];
}

/** Albums grouped into shelves; groups under the facet's minimum size are left out. */
export function buildShelves(
  albums: LabAlbum[],
  group: GroupKey,
  sort: SortKey,
): { shelves: Shelf[]; hiddenGroups: number } {
  const def = GROUPS[group];
  const byKey = new Map<string, LabAlbum[]>();
  for (const a of albums) {
    for (const k of def.keys(a)) {
      const bucket = byKey.get(k);
      if (bucket) bucket.push(a);
      else byKey.set(k, [a]);
    }
  }
  const shelves = [...byKey]
    .filter(([, list]) => list.length >= def.min)
    .map(([key, list]) => ({ key, albums: [...list].sort(SORTS[sort].cmp) }))
    .sort((x, y) =>
      def.byKey
        ? y.key.localeCompare(x.key)
        : y.albums.length - x.albums.length || x.key.localeCompare(y.key),
    );
  return { shelves, hiddenGroups: byKey.size - shelves.length };
}

// ---------- similarity and the Dig queue

/** How alike two albums are: shared genre, subgenre, vibes and tags, minus distance in energy and mood. */
export function similarity(a: LabAlbum, b: LabAlbum): number {
  let s = 0;
  if (a.genre && a.genre === b.genre) s += 3;
  if (a.subgenre && a.subgenre === b.subgenre) s += 2;
  if (a.artists[0] && a.artists[0] === b.artists[0]) s += 0.5;
  s += 1.5 * a.vibes.filter((v) => b.vibes.includes(v)).length;
  if (a.tags.length > 0 && b.tags.length > 0) {
    const shared = a.tags.filter((t) => b.tags.includes(t)).length;
    s += (3 * shared) / (a.tags.length + b.tags.length - shared);
  }
  return s - (Math.abs(mid(a.energy) - mid(b.energy)) + Math.abs(mid(a.mood) - mid(b.mood))) / 40;
}

export function closestAlbums(album: LabAlbum, albums: LabAlbum[], count: number): LabAlbum[] {
  return albums
    .filter((b) => b.id !== album.id)
    .map((b) => ({ b, s: similarity(album, b) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, count)
    .map((x) => x.b);
}

export interface DigState {
  /** Album the dig started from, if any. */
  seedId: string | null;
  vibes: string[];
  genres: string[];
  /** Only albums saved before this year ("rediscover"). */
  savedBeforeYear: number | null;
  /** Every album already shown, kept or skipped. */
  seen: string[];
  kept: string[];
}

export const EMPTY_DIG: DigState = {
  seedId: null,
  vibes: [],
  genres: [],
  savedBeforeYear: null,
  seen: [],
  kept: [],
};

/**
 * What to show next, best first: albums like the seed and like what was kept
 * so far, matching the chosen vibes and genres. Albums already seen, already
 * picked for the list, or filtered out by search are left out.
 */
export function digQueue(albums: LabAlbum[], dig: DigState, picked: string[]): LabAlbum[] {
  const byId = new Map(albums.map((a) => [a.id, a]));
  const seed = dig.seedId ? byId.get(dig.seedId) : undefined;
  const kept = dig.kept.flatMap((id) => byId.get(id) ?? []);
  const skip = new Set([...dig.seen, ...picked, ...(dig.seedId ? [dig.seedId] : [])]);
  return albums
    .filter(
      (a) =>
        !skip.has(a.id) &&
        (dig.savedBeforeYear === null || Number(a.savedAt.slice(0, 4)) < dig.savedBeforeYear),
    )
    .map((a) => {
      let s = 0;
      if (seed) s += 2 * similarity(a, seed);
      if (kept.length > 0) s += kept.reduce((sum, k) => sum + similarity(a, k), 0) / kept.length;
      s += 2.5 * a.vibes.filter((v) => dig.vibes.includes(v)).length;
      if (a.genre && dig.genres.includes(a.genre)) s += 3;
      return { a, s };
    })
    .sort((x, y) => y.s - x.s || x.a.savedAt.localeCompare(y.a.savedAt))
    .map((x) => x.a);
}

// ---------- Map layout

export const MAP_AXES = {
  mood: { label: "Mood", value: (a: LabAlbum) => mid(a.mood) },
  energy: { label: "Energy", value: (a: LabAlbum) => mid(a.energy) },
  year: { label: "Release year", value: (a: LabAlbum) => a.year },
  saved: { label: "Date saved", value: (a: LabAlbum) => Date.parse(a.savedAt) },
  popularity: { label: "Popularity", value: (a: LabAlbum) => a.popularity ?? 0 },
} as const;
export type MapAxis = keyof typeof MAP_AXES;

export const MAP_WORLD = { width: 1700, height: 1300, tile: 40 } as const;

/** 0..1 per album: 40% the value's place in its range, 60% its rank, so the map fills out instead of bunching. */
function spread(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0] ?? 0;
  const range = (sorted[sorted.length - 1] ?? 0) - lo || 1;
  const last = Math.max(1, values.length - 1);
  return values.map(
    (v) =>
      0.4 * ((v - lo) / range) + (0.6 * (sorted.indexOf(v) + sorted.lastIndexOf(v))) / 2 / last,
  );
}

/**
 * Center point of every album on the map, in world units: `x` grows to the
 * right with the across axis, `y` shrinks (goes up) with the up axis.
 * Overlapping tiles are pushed apart. Deterministic for a given input.
 */
export function mapLayout(
  albums: LabAlbum[],
  across: MapAxis,
  up: MapAxis,
): { x: number; y: number }[] {
  const { width, height, tile } = MAP_WORLD;
  const gap = tile + 4;
  const pad = tile;
  const xs = spread(albums.map(MAP_AXES[across].value));
  const ys = spread(albums.map(MAP_AXES[up].value));
  const points = albums.map((a, i) => {
    let h = 7;
    for (let c = 0; c < a.id.length; c++) h = (h * 31 + a.id.charCodeAt(c)) >>> 0;
    return {
      x: pad + (xs[i] ?? 0.5) * (width - 2 * pad) + ((h % 40) - 20),
      y: height - pad - (ys[i] ?? 0.5) * (height - 2 * pad) + (((h >> 8) % 40) - 20),
    };
  });
  const half = tile / 2;
  for (let pass = 0; pass < 40; pass++) {
    // Bucket by cell so each tile is only compared with its neighbours.
    const cells = new Map<number, number[]>();
    const cols = Math.ceil(width / gap) + 2;
    points.forEach((p, i) => {
      const key = Math.floor(p.y / gap) * cols + Math.floor(p.x / gap);
      const cell = cells.get(key);
      if (cell) cell.push(i);
      else cells.set(key, [i]);
    });
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p) continue;
      const cx = Math.floor(p.x / gap);
      const cy = Math.floor(p.y / gap);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const j of cells.get((cy + dy) * cols + cx + dx) ?? []) {
            const q = points[j];
            if (j <= i || !q) continue;
            const ox = q.x - p.x;
            const oy = q.y - p.y;
            const dist = Math.hypot(ox, oy) || 0.01;
            if (dist >= gap) continue;
            const push = (gap - dist) / 2;
            p.x -= (ox / dist) * push;
            p.y -= (oy / dist) * push;
            q.x += (ox / dist) * push;
            q.y += (oy / dist) * push;
          }
        }
      }
    }
    for (const p of points) {
      p.x = Math.max(half, Math.min(width - half, p.x));
      p.y = Math.max(half, Math.min(height - half, p.y));
    }
  }
  return points;
}
