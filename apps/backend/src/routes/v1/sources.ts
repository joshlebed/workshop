// Standalone source-preview route used by the create-list flow before
// commit (replaces the legacy `/v1/album-shelf/preview` endpoint). The
// per-list source-management endpoints live on `listRoutes` in `lists.ts`.
//
// All kind-specific logic lives in `lib/sources/registry.ts` — this route
// just dispatches on `parsed.data.kind`.

import { SOURCE_KIND_NAMES } from "@workshop/shared/sourceKinds";
import { Hono } from "hono";
import { z } from "zod";
import { parseJsonBody } from "../../lib/request.js";
import { ok } from "../../lib/response.js";
import { dispatchFor } from "../../lib/sources/registry.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

export const sourcePreviewRoutes = new Hono();

sourcePreviewRoutes.use("*", requireAuth);

const previewSchema = z.object({
  kind: z.enum(SOURCE_KIND_NAMES),
  config: z.record(z.string(), z.unknown()),
});

export const __test = { previewSchema };

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
    const dispatch = dispatchFor(parsed.data.kind);
    const result = await dispatch.preview(c, parsed.data.config);
    if (!result.ok) return result.response;
    return ok(c, { preview: result.preview });
  },
);
