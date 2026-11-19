import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { users } from "../db/schema.js";
import { getConfig } from "./config.js";
import {
  deleteImageObject,
  getImageObject,
  imageStorageAvailable,
  putImageObject,
} from "./imageStorage.js";
import { logger } from "./logger.js";

/**
 * User-uploaded images (profile pictures, list cover photos): one module owns
 * how they are named, stored, and handed to clients.
 *
 * A picture is an object in image storage (`lib/imageStorage.ts`) under
 * `<kind>/<owner id>/<content hash>.<ext>`, and its row keeps only that key
 * (`users.avatar_key`, `lists.cover_photo_key`). The key is content-addressed,
 * so an object never changes and `GET /v1/images/<key>` is cached for good.
 *
 * Clients upload a base64 `data:` URL in the field they always used
 * (`avatarUrl`, `coverPhotoUrl`) and get back an `https` URL of the image
 * route in that same field.
 */

const IMAGE_KINDS = ["avatars", "list-covers"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const KEY_RE =
  /^(avatars|list-covers)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{16}\.(png|jpg|webp|gif)$/;

export interface Image {
  contentType: string;
  body: Buffer;
}

export function isImageKey(value: string): boolean {
  return KEY_RE.test(value);
}

function contentTypeOfExt(ext: string): string {
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
}

/** A `data:` URL's picture, or null when it is not one we accept. */
function decodeImageDataUrl(dataUrl: string): (Image & { ext: string }) | null {
  const match = dataUrl.match(DATA_URL_RE);
  if (!match) return null;
  const kind = match[1] ?? "png";
  return {
    contentType: contentTypeOfExt(kind),
    body: Buffer.from(match[2] ?? "", "base64"),
    ext: kind === "jpeg" ? "jpg" : kind,
  };
}

/** Writes an uploaded picture to storage and returns its key; null = not a picture. */
export async function storeImage(
  kind: ImageKind,
  ownerId: string,
  dataUrl: string,
): Promise<string | null> {
  const image = decodeImageDataUrl(dataUrl);
  if (!image) return null;
  const hash = createHash("sha256").update(image.body).digest("hex").slice(0, 16);
  const key = `${kind}/${ownerId}/${hash}.${image.ext}`;
  await putImageObject(key, image.body, image.contentType);
  return key;
}

/** The stored picture for a key, or null when the object is missing. */
export async function readImage(key: string): Promise<Image | null> {
  if (!isImageKey(key)) return null;
  const body = await getImageObject(key);
  if (!body) return null;
  return { contentType: contentTypeOfExt(key.slice(key.lastIndexOf(".") + 1)), body };
}

/**
 * Gives another owner their own copy of a picture (duplicating a list), so
 * deleting one never takes the other's. Null when the source is missing.
 */
export async function copyImage(
  key: string,
  kind: ImageKind,
  ownerId: string,
): Promise<string | null> {
  const image = await readImage(key);
  if (!image) return null;
  const copy = `${kind}/${ownerId}/${key.slice(key.lastIndexOf("/") + 1)}`;
  await putImageObject(copy, image.body, image.contentType);
  return copy;
}

/**
 * Removes a picture no row points at any more. Best effort: the row has
 * already moved on, and an orphaned object is not worth failing a request.
 */
export async function discardImage(key: string | null | undefined): Promise<void> {
  if (!key || !imageStorageAvailable()) return;
  try {
    await deleteImageObject(key);
  } catch (error) {
    logger.warn("image object delete failed", { key, error });
  }
}

/**
 * The origin clients reach this API at. Locally the web apps call the API
 * through their dev server's `/api` proxy, which says so in
 * `X-Workshop-Public-Base`; a deployed stage never trusts that header.
 */
function publicApiBase(c: Context): string {
  if (getConfig().isLocal) {
    const forwarded = c.req.header("X-Workshop-Public-Base");
    if (forwarded && /^https?:\/\/[^\s"'<>]+$/.test(forwarded)) return forwarded.replace(/\/$/, "");
  }
  return new URL(c.req.url).origin;
}

/**
 * What a client gets in `avatarUrl` / `coverPhotoUrl`: the image route's URL
 * for the stored picture, null without one.
 */
export function imageUrlForClient(c: Context, key: string | null): string | null {
  return key ? `${publicApiBase(c)}/v1/images/${key}` : null;
}

/**
 * Resolves the value a client sent for an image field into the row's new key.
 *
 * - `null` clears the picture.
 * - a `data:` URL is a new upload and is written to storage.
 * - the URL the server itself handed out for the current picture means "no
 *   change" (a form re-submitting what it loaded).
 *
 * `unavailable` is a deployed stage with no bucket: answer 503, never store.
 */
export async function resolveImageWrite(
  kind: ImageKind,
  ownerId: string,
  value: string | null,
  currentKey: string | null,
): Promise<
  | { ok: true; changed: boolean; key: string | null }
  | { ok: false; reason: "invalid" | "unavailable" }
> {
  if (value === null) {
    return { ok: true, changed: currentKey !== null, key: null };
  }
  if (currentKey && value.endsWith(`/v1/images/${currentKey}`)) {
    return { ok: true, changed: false, key: currentKey };
  }
  if (!decodeImageDataUrl(value)) return { ok: false, reason: "invalid" };
  if (!imageStorageAvailable()) return { ok: false, reason: "unavailable" };
  const key = await storeImage(kind, ownerId, value);
  if (!key) return { ok: false, reason: "invalid" };
  return { ok: true, changed: true, key };
}

/**
 * A profile picture's version in SQL: 8 hex chars that change whenever the
 * picture does, NULL without one. The key carries a content hash, so hashing
 * the key is hashing the picture.
 */
export const avatarVersionSql = sql<string | null>`left(md5(${users.avatarKey}), 8)`;
