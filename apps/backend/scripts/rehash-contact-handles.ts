/**
 * Recompute every "Let friends find me" handle (`user_contact_handles`) from
 * the owner's `users.email`. Run it after changing the pepper
 * (`CONTACT_HASH_PEPPER`, or `SESSION_SECRET` while the pepper is derived from
 * it): until then every stored hash is unmatchable and contacts find nobody.
 * Needs the NEW secret in the environment, the same one the Lambda now runs with.
 *
 *   AWS_PROFILE=workshop-prod SESSION_SECRET=… DATABASE_URL="$(aws ssm get-parameter \
 *     --name /workshop-prod/db/url --with-decryption --query Parameter.Value --output text)" \
 *     pnpm --filter @workshop/backend run ops:rehash-contact-handles
 */

import { rehashAllContactHandles } from "../src/lib/contactHandles.js";

rehashAllContactHandles()
  .then((result) => {
    console.log(`rehashed ${result.updated} handle(s), removed ${result.removed}`);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
