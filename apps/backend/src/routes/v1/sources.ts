// Standalone source-preview route used by the create-list flow before
// commit (replaces the legacy `/v1/album-shelf/preview` endpoint). The
// per-list source-management endpoints live on `listRoutes` in `lists.ts`.

import { SOURCE_KIND_NAMES } from "@workshop/shared/sourceKinds";
import { Hono } from "hono";
import { z } from "zod";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { previewSpotifyPlaylist } from "../../lib/sources/spotifyPlaylist.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

export const sourcePreviewRoutes = new Hono();

sourcePreviewRoutes.use("*", requireAuth);

const previewSchema = z.object({
  kind: z.enum(SOURCE_KIND_NAMES),
  config: z.record(z.string(), z.unknown()),
});

sourcePreviewRoutes.post(
  "/preview",
  rateLimit({
    family: "v1.sources.preview",
    limit: 30,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const parsed = await parseJsonBody(c, previewSchema);
    if (!parsed.ok) return parsed.response;
    if (parsed.data.kind === "spotify_playlist") {
      const url =
        typeof parsed.data.config.spotifyPlaylistUrl === "string"
          ? parsed.data.config.spotifyPlaylistUrl
          : "";
      const result = await previewSpotifyPlaylist(c, url);
      if (!result.ok) return result.response;
      return ok(c, { preview: result.preview });
    }
    return err(c, "VALIDATION", `unsupported source kind: ${parsed.data.kind}`);
  },
);
