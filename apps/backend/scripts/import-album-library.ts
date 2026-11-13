/**
 * Album lab (admin-only experiment): load a user's saved Spotify albums and
 * their genre / vibe tags from a JSON file into `spotify_albums` +
 * `spotify_library_albums`. The file is an array of `AlbumLibraryAlbum`
 * (`@workshop/shared`), validated before anything is written. Re-running
 * replaces that user's library with the file's contents; nothing else is
 * touched.
 *
 *   DATABASE_URL=… pnpm --filter @workshop/backend run ops:import-album-library -- \
 *     --file=/path/to/albums.json --email=<user email> [--dry]
 */

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import { albumLibraryImportSchema, importAlbumLibrary } from "../src/lib/albumLibrary.js";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

async function main() {
  const file = arg("--file");
  const email = arg("--email");
  if (!file || !email) {
    console.error("usage: ops:import-album-library -- --file=<json> --email=<email> [--dry]");
    process.exit(2);
  }
  const parsed = albumLibraryImportSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    console.error("invalid album file:", JSON.stringify(parsed.error.issues.slice(0, 5)));
    process.exit(1);
  }
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    console.error("no user with that email");
    process.exit(1);
  }
  if (process.argv.includes("--dry")) {
    console.log(`dry run: would import ${parsed.data.length} albums for user ${user.id}`);
    process.exit(0);
  }
  const result = await importAlbumLibrary(user.id, parsed.data);
  console.log(`imported ${result.albums} albums for user ${user.id}, removed ${result.removed}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
