import { z } from "zod";

const csv = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );

const configSchema = z.object({
  stage: z.enum(["local", "prod"]).default("local"),
  databaseUrl: z.string().min(1),
  sessionSecret: z.string().min(32),
  awsRegion: z.string().default("us-east-1"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Apple Sign in audiences. iOS uses the bundle id; web uses the Services ID.
  // Either or both may be empty in local dev — Apple sign-in 501s until populated.
  appleBundleId: z.string().optional().default(""),
  appleServicesId: z.string().optional().default(""),
  // Google OAuth client IDs. Same shape as Apple — iOS + web are separate audiences.
  googleIosClientId: z.string().optional().default(""),
  googleWebClientId: z.string().optional().default(""),
  // Comma-separated extra audiences (e.g. additional web origins). Optional.
  appleExtraAudiences: csv,
  googleExtraAudiences: csv,
  // Enrichment provider API keys (Phase 2). Empty in local dev — search routes
  // 503 with a clear error until populated. SSM wires the real values in 0c-2.
  tmdbApiKey: z.string().optional().default(""),
  googleBooksApiKey: z.string().optional().default(""),
  // Dev-only sign-in route for E2E tests. Must be explicitly opted in —
  // treated as a production footgun otherwise. See routes/v1/auth.ts.
  devAuthEnabled: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  // Spotify OAuth (Authorization Code + PKCE). Empty defaults so the rest of
  // the API still boots without Spotify configured — Spotify routes 503 until
  // these are populated. clientSecret is optional: with PKCE it can be omitted
  // for public clients, but Spotify still recommends it for confidential ones.
  spotifyClientId: z.string().optional().default(""),
  spotifyClientSecret: z.string().optional().default(""),
  // The redirect URI registered on the Spotify dashboard. Locally, default to
  // `http://localhost:8787/v1/spotify/auth/callback`. The backend handles the
  // callback then forwards the user back to the app via the `workshop://`
  // deep link scheme.
  spotifyRedirectUri: z.string().optional().default(""),
  // Where the backend redirects the browser after a successful Spotify
  // callback — typically a deep link the mobile app or web bundle handles.
  // Defaults to the local web origin.
  spotifyAppRedirectUri: z.string().optional().default(""),
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
    appleBundleId: process.env.APPLE_BUNDLE_ID,
    appleServicesId: process.env.APPLE_SERVICES_ID,
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID,
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
    appleExtraAudiences: process.env.APPLE_EXTRA_AUDIENCES,
    googleExtraAudiences: process.env.GOOGLE_EXTRA_AUDIENCES,
    tmdbApiKey: process.env.TMDB_API_KEY,
    googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY,
    devAuthEnabled: process.env.DEV_AUTH_ENABLED,
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    spotifyRedirectUri: process.env.SPOTIFY_REDIRECT_URI,
    spotifyAppRedirectUri: process.env.SPOTIFY_APP_REDIRECT_URI,
  });
  cached = { ...parsed, isLocal: parsed.stage === "local" };
  return cached;
}

export function appleAudiences(): string[] {
  const c = getConfig();
  return [c.appleBundleId, c.appleServicesId, ...c.appleExtraAudiences].filter(Boolean);
}

export function googleAudiences(): string[] {
  const c = getConfig();
  return [c.googleIosClientId, c.googleWebClientId, ...c.googleExtraAudiences].filter(Boolean);
}

export function resetConfigForTesting() {
  cached = null;
}
