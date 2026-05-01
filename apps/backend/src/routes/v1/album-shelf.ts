// Standalone album-shelf utility routes that don't fit neatly under
// /v1/lists or /v1/items. Currently just the playlist URL preview used by
// the create-list flow's blur-validation step (docs/album-shelf.md §4.1).
//
// Auth-required: validation happens against Workshop's app-level Spotify
// credentials, but exposing it without auth would let unauthenticated
// callers burn our app token's rate-limit budget.

import { Hono } from "hono";
import { z } from "zod";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { fetchPlaylistMeta } from "../../lib/spotify/app-client.js";
import { mapSpotifyError } from "../../lib/spotify/error-mapping.js";
import { InvalidPlaylistUrlError, parsePlaylistId } from "../../lib/spotify/playlist-parser.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

export const albumShelfRoutes = new Hono();

albumShelfRoutes.use("*", requireAuth);

const previewSchema = z.object({
  url: z.string().min(1).max(2048),
});

albumShelfRoutes.post(
  "/preview",
  rateLimit({
    family: "v1.album-shelf.preview",
    limit: 30,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const parsed = await parseJsonBody(c, previewSchema);
    if (!parsed.ok) return parsed.response;

    let playlistId: string;
    try {
      playlistId = parsePlaylistId(parsed.data.url);
    } catch (e) {
      if (e instanceof InvalidPlaylistUrlError) {
        return err(c, "VALIDATION", "invalid playlist URL", { code: "INVALID_PLAYLIST_URL" });
      }
      throw e;
    }

    try {
      const meta = await fetchPlaylistMeta(playlistId);
      if (meta.public === false) {
        return err(c, "VALIDATION", "playlist must be public", {
          code: "PLAYLIST_NOT_AVAILABLE",
        });
      }
      return ok(c, {
        playlistId,
        name: meta.name,
        ownerName: meta.owner?.display_name ?? null,
        trackCount: meta.tracks.total,
      });
    } catch (e) {
      const mapped = mapSpotifyError(c, e);
      if (mapped) return mapped;
      throw e;
    }
  },
);
