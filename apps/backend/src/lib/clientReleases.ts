// The operator-set "update from the App Store" nudge (`client_releases`).
// Read publicly by `GET /v1/client/release`; written ONLY by the operator via
// `PUT /v1/admin/client-release` (real-admin gate) from the HighScore admin
// dashboard. Nothing else — no seed, migration, script, job, or agent — may
// write these values. See docs/release-nudge-runbook.md.

import type {
  AdminClientReleaseResponse,
  ClientReleaseResponse,
  UpdateClientReleaseRequest,
} from "@workshop/shared";
import {
  CLIENT_RELEASE_PLATFORMS,
  CLIENT_RELEASE_VERSION_PATTERN,
  type ClientReleasePlatform,
  WORKSHOP_CLIENTS,
  type WorkshopClient,
} from "@workshop/shared/constants";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { getDb } from "../db/client.js";
import { clientReleases, users } from "../db/schema.js";

type Db = ReturnType<typeof getDb>;

const EMPTY_CLIENT_RELEASE: ClientReleaseResponse = {
  latestVersion: null,
  minimumVersion: null,
  storeUrl: null,
  message: null,
};

export const clientReleaseQuerySchema = z.object({
  client: z.enum(WORKSHOP_CLIENTS),
  platform: z.enum(CLIENT_RELEASE_PLATFORMS),
});

/** Numeric `major.minor.patch` compare: negative when a < b. */
export function compareReleaseVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const versionField = z
  .string()
  .trim()
  .regex(CLIENT_RELEASE_VERSION_PATTERN, "version must look like 1.2.3")
  .nullable();

// Empty strings from a cleared form field mean "unset".
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const updateClientReleaseSchema = z
  .object({
    client: z.enum(WORKSHOP_CLIENTS),
    platform: z.enum(CLIENT_RELEASE_PLATFORMS),
    latestVersion: z.preprocess(blankToNull, versionField),
    minimumVersion: z.preprocess(blankToNull, versionField),
    storeUrl: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(500)
        .url()
        .refine(
          (u) => /^(https|itms-apps):\/\//i.test(u),
          "store URL must be https:// or itms-apps://",
        )
        .nullable(),
    ),
    message: z.preprocess(blankToNull, z.string().trim().max(280).nullable()),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.latestVersion &&
      v.minimumVersion &&
      compareReleaseVersions(v.minimumVersion, v.latestVersion) > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumVersion"],
        message: "minimum version must be <= latest version",
      });
    }
  });

// Compile-time pin: the validated body is exactly the shared request type.
type _BodyMatchesShared =
  z.infer<typeof updateClientReleaseSchema> extends UpdateClientReleaseRequest
    ? UpdateClientReleaseRequest extends z.infer<typeof updateClientReleaseSchema>
      ? true
      : never
    : never;
const _bodyMatchesShared: _BodyMatchesShared = true;
void _bodyMatchesShared;

export async function readClientRelease(
  db: Db,
  client: WorkshopClient,
  platform: ClientReleasePlatform,
): Promise<AdminClientReleaseResponse> {
  const [row] = await db
    .select({
      latestVersion: clientReleases.latestVersion,
      minimumVersion: clientReleases.minimumVersion,
      storeUrl: clientReleases.storeUrl,
      message: clientReleases.message,
      updatedAt: clientReleases.updatedAt,
      updatedById: clientReleases.updatedBy,
      updatedByName: users.displayName,
    })
    .from(clientReleases)
    .leftJoin(users, eq(users.id, clientReleases.updatedBy))
    .where(and(eq(clientReleases.client, client), eq(clientReleases.platform, platform)))
    .limit(1);
  if (!row) return { client, platform, ...EMPTY_CLIENT_RELEASE, updatedAt: null, updatedBy: null };
  return {
    client,
    platform,
    latestVersion: row.latestVersion,
    minimumVersion: row.minimumVersion,
    storeUrl: row.storeUrl,
    message: row.message,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedById ? { id: row.updatedById, displayName: row.updatedByName } : null,
  };
}

/** The one writer. Callers must have passed the real-admin gate. */
export async function writeClientRelease(
  db: Db,
  input: UpdateClientReleaseRequest,
  actorUserId: string,
): Promise<void> {
  const now = new Date();
  const values = {
    latestVersion: input.latestVersion,
    minimumVersion: input.minimumVersion,
    storeUrl: input.storeUrl,
    message: input.message,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  await db
    .insert(clientReleases)
    .values({ client: input.client, platform: input.platform, ...values })
    .onConflictDoUpdate({ target: [clientReleases.client, clientReleases.platform], set: values });
}
