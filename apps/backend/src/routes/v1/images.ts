import { Hono } from "hono";
import { isImageKey, readImage } from "../../lib/images.js";
import { err } from "../../lib/response.js";

/**
 * `GET /v1/images/<kind>/<owner id>/<content hash>.<ext>` — a stored picture
 * by its key. Public and unauthenticated, like the pictures were when they
 * travelled inline: the 64-bit content hash in the key is unguessable, and the
 * API only hands a key to someone allowed to see that picture. The key names
 * the content, so the response never changes and is cached for good; no
 * database query is involved.
 */
export const imageRoutes = new Hono();

imageRoutes.get("/:kind/:owner/:file", async (c) => {
  const key = `${c.req.param("kind")}/${c.req.param("owner")}/${c.req.param("file")}`;
  const image = isImageKey(key) ? await readImage(key) : null;
  if (!image) return err(c, "NOT_FOUND", "image not found");
  return new Response(image.body, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": image.contentType,
    },
  });
});
