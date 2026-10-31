/**
 * Catalog ops audit — read-only. Prints the report the daily `catalog-audit`
 * Niteshift automation acts on (docs/catalog-ops-runbook.md): unlisted games
 * with players (+ suggested game type, content flag), listed games with
 * parser / formatter / conflict problems, and stale catalog extras.
 *
 *   DATABASE_URL="$(aws ssm get-parameter --name /workshop-prod/db/url \
 *     --with-decryption --query Parameter.Value --output text)" \
 *     pnpm --filter @workshop/backend run ops:catalog-audit [--json]
 *
 * STRICTLY READ-ONLY: the session is opened with
 * `default_transaction_read_only = on`, so a stray write throws.
 */

import { sql } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (pull it from SSM /workshop-prod/db/url).");
  process.exit(1);
}
process.env.STAGE ??= "local";
process.env.SESSION_SECRET ??= "catalog-audit-read-only-session-secret-unused";

const { getDb } = await import("../src/db/client.js");
const { renderCatalogAuditMarkdown, runCatalogAudit } = await import("../src/lib/catalogAudit.js");

const db = getDb();
await db.execute(sql`set default_transaction_read_only = on`);
const report = await runCatalogAudit();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderCatalogAuditMarkdown(report));
}
process.exit(0);
