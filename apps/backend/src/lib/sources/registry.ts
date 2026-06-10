// Server-side source dispatch. Pairs each `SourceKind` from
// `@workshop/shared/sourceKinds` with its `previewSource` and `syncSource`
// implementations on the backend. Adding a new source kind = one entry in
// the shared registry + one implementation file + one entry here; no edits
// to the route handlers in `lists.ts` / `sources.ts`.
//
// The dispatch contract is intentionally small:
//   - preview(c, config) → either an err Response or `{ config, preview }`
//   - sync({ listId, userId, config, db }) → { addedCount, refreshedAt }
//
// Both halves bottom out at the same lib modules a route would import
// directly (`./spotifyPlaylist.ts`, `./letterboxdList.ts`), so the route
// can stay slim.

import type { SourceKind } from "@workshop/shared/sourceKinds";
import type { Context } from "hono";
import type { DbClient } from "../sql.js";
import { previewLetterboxdList, syncLetterboxdListSource } from "./letterboxdList.js";
import { previewLetterboxdMatch, syncLetterboxdMatchSource } from "./letterboxdMatch.js";
import { previewSpotifyPlaylist, syncSpotifyPlaylistSource } from "./spotifyPlaylist.js";

interface PreviewResult {
  /** Normalized config to persist into `list_sources.config`. */
  config: Record<string, unknown>;
  /** Display-shaped preview to show the user before commit. */
  preview: { kind: string; [k: string]: unknown };
}

interface SyncArgs {
  listId: string;
  userId: string;
  config: Record<string, unknown>;
  db: DbClient;
}

interface SyncResult {
  addedCount: number;
  refreshedAt: Date;
}

interface SourceDispatch {
  /** Validate the user-supplied config and return a normalized version + preview. */
  preview: (
    c: Context,
    rawConfig: Record<string, unknown>,
  ) => Promise<({ ok: true } & PreviewResult) | { ok: false; response: Response }>;
  /** Run the kind-specific sync (no recording of the activity event — the route does that). */
  sync: (args: SyncArgs) => Promise<SyncResult>;
}

const DISPATCH: Record<SourceKind, SourceDispatch> = {
  spotify_playlist: {
    preview: async (c, raw) => {
      const url = typeof raw.spotifyPlaylistUrl === "string" ? raw.spotifyPlaylistUrl : "";
      const result = await previewSpotifyPlaylist(c, url);
      if (!result.ok) return result;
      return {
        ok: true,
        config: result.config as unknown as Record<string, unknown>,
        preview: result.preview as unknown as PreviewResult["preview"],
      };
    },
    sync: async ({ listId, userId, config, db }) => {
      const cfg = config as { spotifyPlaylistUrl: string; spotifyPlaylistId: string };
      return await syncSpotifyPlaylistSource({ listId, userId, config: cfg, db });
    },
  },
  letterboxd_list: {
    preview: async (c, raw) => {
      const url = typeof raw.letterboxdUrl === "string" ? raw.letterboxdUrl : "";
      const result = await previewLetterboxdList(c, url);
      if (!result.ok) return result;
      return {
        ok: true,
        config: result.config as unknown as Record<string, unknown>,
        preview: result.preview as unknown as PreviewResult["preview"],
      };
    },
    sync: async ({ listId, userId, config, db }) => {
      const cfg = config as {
        letterboxdUrl: string;
        letterboxdUsername: string;
        letterboxdListSlug: string;
      };
      return await syncLetterboxdListSource({ listId, userId, config: cfg, db });
    },
  },
  letterboxd_match: {
    preview: async (c, _raw) => {
      // No config to validate — the source derives everything from the
      // list's members at sync time.
      const result = await previewLetterboxdMatch(c);
      return {
        ok: true,
        config: result.config as Record<string, unknown>,
        preview: result.preview as unknown as PreviewResult["preview"],
      };
    },
    sync: async ({ listId, userId, config, db }) => {
      return await syncLetterboxdMatchSource({ listId, userId, config, db });
    },
  },
};

/** Direct accessor for routes that have already validated the kind. */
export function dispatchFor(kind: SourceKind): SourceDispatch {
  return DISPATCH[kind];
}
