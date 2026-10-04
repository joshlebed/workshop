import { z } from "zod";

/**
 * Comma-separated env value → trimmed, de-duplicated, non-empty list.
 *
 * Every OAuth audience var is parsed through this. A single value with no
 * comma yields a one-element list, so existing SSM/Terraform wiring behaves
 * exactly as it did before multi-audience support landed. Appending a second
 * audience is an ops-only change (`aws ssm put-parameter --overwrite`), no
 * code or env var rename required — see docs/highscore-migration-plan.md.
 */
const csv = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return [];
    const parts = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set(parts)];
  });

// Default OpenAI model for both teach steps (GPT-6.1 Sol). It accepts
// reasoning effort low | medium | high | xhigh | max — not none/minimal.
const DEFAULT_OPENAI_TEACH_MODEL = "gpt-6.1-sol";

// Optional model-id override: unset or blank (an empty dotenv line) falls back
// to the default, so the model can change without a code change.
const openaiModel = z
  .string()
  .optional()
  .transform((v) => v?.trim() || DEFAULT_OPENAI_TEACH_MODEL);

const configSchema = z.object({
  stage: z.enum(["local", "prod"]).default("local"),
  databaseUrl: z.string().min(1),
  sessionSecret: z.string().min(32),
  awsRegion: z.string().default("us-east-1"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Apple Sign in audiences. iOS uses the bundle id; web uses the Services ID.
  // Both are comma-separated lists so one backend can verify tokens from more
  // than one client app (Workshop `dev.josh.workshop` + HighScore, etc.).
  // Either or both may be empty in local dev — Apple sign-in 501s until populated.
  appleBundleIds: csv,
  appleServicesIds: csv,
  // Google OAuth client IDs. Same shape as Apple — iOS + web are separate
  // audiences, each a comma-separated list.
  googleIosClientIds: csv,
  googleWebClientIds: csv,
  // Comma-separated extra audiences (e.g. additional web origins). Optional.
  appleExtraAudiences: csv,
  googleExtraAudiences: csv,
  // Sign in with Apple server-to-server credentials. Only needed to exchange a
  // sign-in `authorizationCode` for a refresh token and to revoke it on account
  // deletion (App Store Review Guideline 5.1.1(v)). All three must be present
  // or the revocation path is skipped and reported as `unavailable` — nothing
  // else in auth depends on them.
  appleTeamId: z.string().optional().default(""),
  appleKeyId: z.string().optional().default(""),
  // Contents of the .p8 private key downloaded from the Apple Developer portal.
  // Newlines may be escaped as `\n` so the value survives SSM/Lambda env.
  applePrivateKey: z
    .string()
    .optional()
    .default("")
    .transform((v) => v.replace(/\\n/g, "\n").trim()),
  // Enrichment provider API keys (Phase 2). Empty in local dev — search routes
  // 503 with a clear error until populated. SSM wires the real values in 0c-2.
  tmdbApiKey: z.string().optional().default(""),
  googleBooksApiKey: z.string().optional().default(""),
  // TypeSafe (Jev) API key. Server-side only — never ship it to a client bundle.
  typesafeApiKey: z.string().optional().default(""),
  // OpenAI API key for the HighScore teach flow. Server-side only; empty when
  // unset, and nothing else depends on it.
  openaiApiKey: z.string().optional().default(""),
  // Teach step 1 ("find targets") and step 2 ("write code") model ids.
  openaiTeachTargetsModel: openaiModel,
  openaiTeachCodegenModel: openaiModel,
  // Dev-only sign-in route for E2E tests. Must be explicitly opted in —
  // treated as a production footgun otherwise. See routes/v1/auth.ts.
  devAuthEnabled: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  // Games surface flag (spec §3). The /v1/games routes 404 unless enabled —
  // on automatically when STAGE=local (dev/sandbox/e2e); prod stays off until
  // ENABLE_GAMES=1 lands in the Lambda env. Mirrors the client's
  // EXPO_PUBLIC_ENABLE_GAMES tab flag (G0).
  gamesEnabled: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  // Game-score recognition (lib/gameRecognition.ts). `off` (default, and what
  // any unrecognized value means): nothing runs. `shadow`: every score post is
  // also run through recognition and the prediction is logged against the game
  // the user chose — behaviour is unchanged and POST /v1/games/recognize stays
  // 404. `on`: the endpoint answers, and the shadow log keeps running.
  gameRecognition: z.enum(["off", "shadow", "on"]).catch("off"),
  // Spotify Web API app credentials (Client Credentials flow). Used by the
  // Album Shelf feature to read public playlists with an app-level token —
  // no per-user OAuth. Empty defaults so the rest of the API still boots
  // without Spotify configured; Album Shelf routes 503 until these are set.
  spotifyClientId: z.string().optional().default(""),
  spotifyClientSecret: z.string().optional().default(""),
  // Discord webhook URL for operator-facing notifications (new signups, new
  // lists). Empty in local dev — the notifier no-ops. See lib/discord.ts.
  discordNotifyWebhookUrl: z.string().optional().default(""),
});

type Config = z.infer<typeof configSchema> & { isLocal: boolean };

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = configSchema.parse({
    stage: process.env.STAGE,
    databaseUrl: process.env.DATABASE_URL,
    sessionSecret: process.env.SESSION_SECRET,
    awsRegion: process.env.AWS_REGION,
    logLevel: process.env.LOG_LEVEL,
    appleBundleIds: process.env.APPLE_BUNDLE_ID,
    appleServicesIds: process.env.APPLE_SERVICES_ID,
    googleIosClientIds: process.env.GOOGLE_IOS_CLIENT_ID,
    googleWebClientIds: process.env.GOOGLE_WEB_CLIENT_ID,
    appleExtraAudiences: process.env.APPLE_EXTRA_AUDIENCES,
    googleExtraAudiences: process.env.GOOGLE_EXTRA_AUDIENCES,
    appleTeamId: process.env.APPLE_TEAM_ID,
    appleKeyId: process.env.APPLE_KEY_ID,
    applePrivateKey: process.env.APPLE_PRIVATE_KEY,
    tmdbApiKey: process.env.TMDB_API_KEY,
    googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY,
    typesafeApiKey: process.env.TYPESAFE_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiTeachTargetsModel: process.env.OPENAI_TEACH_TARGETS_MODEL,
    openaiTeachCodegenModel: process.env.OPENAI_TEACH_CODEGEN_MODEL,
    devAuthEnabled: process.env.DEV_AUTH_ENABLED,
    gamesEnabled: process.env.ENABLE_GAMES,
    gameRecognition: process.env.GAME_RECOGNITION,
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    discordNotifyWebhookUrl: process.env.DISCORD_NOTIFY_WEBHOOK_URL,
  });
  cached = { ...parsed, isLocal: parsed.stage === "local" };
  return cached;
}

/**
 * Every audience an Apple identity token may legitimately be issued for.
 * Order is irrelevant — `jose` accepts a token whose `aud` matches any entry.
 */
export function appleAudiences(): string[] {
  const c = getConfig();
  return [...new Set([...c.appleBundleIds, ...c.appleServicesIds, ...c.appleExtraAudiences])];
}

/** Same as {@link appleAudiences}, for Google id_tokens. */
export function googleAudiences(): string[] {
  const c = getConfig();
  return [
    ...new Set([...c.googleIosClientIds, ...c.googleWebClientIds, ...c.googleExtraAudiences]),
  ];
}

export function resetConfigForTesting() {
  cached = null;
}
