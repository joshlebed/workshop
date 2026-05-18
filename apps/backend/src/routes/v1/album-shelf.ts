// Legacy alias for the source-preview endpoint. New code uses
// `POST /v1/sources/preview` with `{ kind: "spotify_playlist", config:
// { spotifyPlaylistUrl: ... } }`. Mobile clients ship with the new path,
// but this thin shim is kept so any stale builds out there don't break on
// the create-list playlist step.

import { Hono } from "hono";
import { z } from "zod";
import { parseJsonBody } from "../../lib/request.js";
import { ok } from "../../lib/response.js";
import { previewSpotifyPlaylist } from "../../lib/sources/spotifyPlaylist.js";
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
    const result = await previewSpotifyPlaylist(c, parsed.data.url);
    if (!result.ok) return result.response;
    return ok(c, {
      playlistId: result.preview.playlistId,
      name: result.preview.name,
      ownerName: result.preview.ownerName,
      trackCount: result.preview.trackCount,
    });
  },
);
