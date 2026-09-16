/**
 * Eject an abusive user (App Store Review Guideline 1.2 — "act on objectionable
 * content reports within 24 hours by removing the content and ejecting the
 * user"). Permanently deletes the account through the same code path as the
 * in-app `DELETE /v1/users/me` (`lib/accountDeletion.ts`), which takes their
 * profile, scores, reactions, friend edges, invites and share links with it —
 * so removing the content and ejecting the user is one step. Their
 * `content_reports` rows are marked resolved first, so the audit trail
 * survives the cascade.
 *
 * Point it at prod with the SSM connection string:
 *
 *   AWS_PROFILE=workshop-prod DATABASE_URL=$(./scripts/db-url.sh) \
 *     pnpm --filter @workshop/backend run admin:eject -- --user-id=<uuid>
 *
 * Flags:
 *   --user-id=<uuid>   the target (the id is in the #workshop-admin report ping)
 *   --dry              print what would be deleted (open reports, label) and exit
 *   --yes              skip the 5s countdown
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { contentReports, users } from "../src/db/schema.js";
import { deleteUserAccount } from "../src/lib/accountDeletion.js";
import { userLabel } from "../src/lib/admin.js";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? (hit.split("=")[1] ?? null) : null;
}
const flag = (name: string) => process.argv.includes(name);

async function main() {
  const userId = arg("--user-id");
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    console.error("usage: admin:eject -- --user-id=<uuid> [--dry] [--yes]");
    process.exit(2);
  }
  const db = getDb();
  const [user] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    console.error(`no user ${userId}`);
    process.exit(1);
  }
  const open = await db
    .select({
      id: contentReports.id,
      kind: contentReports.contentKind,
      reason: contentReports.reason,
    })
    .from(contentReports)
    .where(
      sql`${contentReports.targetUserId} = ${userId} AND ${contentReports.resolvedAt} IS NULL`,
    );
  console.log(`target: ${userLabel(user)} (${user.id})`);
  console.log(
    `open reports: ${open.length}${open.length ? ` — ${open.map((r) => `${r.kind}/${r.reason}`).join(", ")}` : ""}`,
  );
  if (flag("--dry")) return;

  if (!flag("--yes")) {
    console.log("deleting in 5s — Ctrl-C to abort");
    await new Promise((r) => setTimeout(r, 5000));
  }
  await db
    .update(contentReports)
    .set({ resolvedAt: new Date() })
    .where(
      sql`${contentReports.targetUserId} = ${userId} AND ${contentReports.resolvedAt} IS NULL`,
    );
  const counts = await deleteUserAccount(userId);
  console.log("ejected", counts);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
