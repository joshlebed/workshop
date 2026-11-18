import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "./config.js";

/**
 * Where image bytes are kept. Two drivers behind one interface:
 *
 * - `s3`: the private image bucket (infra/images.tf), used whenever
 *   `IMAGE_BUCKET` is set. Reachable only by this Lambda's role; images are
 *   served through the API, never by a bucket URL.
 * - `fs`: a directory on disk (`IMAGE_STORAGE_DIR`), used locally — dev,
 *   tests, the Niteshift sandbox (which fills it from the bucket).
 *
 * Images are never kept in Postgres. A deployed stage without a bucket has no
 * storage at all (`imageStorageAvailable()` is false) and refuses uploads,
 * rather than writing to a Lambda's throwaway disk.
 *
 * Keys come from `lib/images.ts`, which validates their shape; nothing here
 * accepts a key from a request.
 */
interface ImageStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The object's bytes, or null when it does not exist. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

function s3Storage(bucket: string, endpoint: string): ImageStorage {
  const client = new S3Client(endpoint ? { endpoint, forcePathStyle: true } : {});
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
      } catch (error) {
        if (error instanceof Error && error.name === "NoSuchKey") return null;
        throw error;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

function fsStorage(dir: string): ImageStorage {
  return {
    async put(key, body) {
      const path = join(dir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      try {
        return await readFile(join(dir, key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(join(dir, key), { force: true });
    },
  };
}

let cached: ImageStorage | null | undefined;

function storage(): ImageStorage | null {
  if (cached !== undefined) return cached;
  const config = getConfig();
  if (config.imageBucket) cached = s3Storage(config.imageBucket, config.imageS3Endpoint);
  else if (config.isLocal) cached = fsStorage(config.imageStorageDir);
  else cached = null;
  return cached;
}

/** False only on a deployed stage with no bucket configured. */
export function imageStorageAvailable(): boolean {
  return storage() !== null;
}

class ImageStorageUnavailableError extends Error {
  constructor() {
    super("image storage is not configured");
    this.name = "ImageStorageUnavailableError";
  }
}

function required(): ImageStorage {
  const s = storage();
  if (!s) throw new ImageStorageUnavailableError();
  return s;
}

export function putImageObject(key: string, body: Buffer, contentType: string): Promise<void> {
  return required().put(key, body, contentType);
}

/** Null when the object is missing or there is no storage to read from. */
export async function getImageObject(key: string): Promise<Buffer | null> {
  return (await storage()?.get(key)) ?? null;
}

export function deleteImageObject(key: string): Promise<void> {
  return required().delete(key);
}
