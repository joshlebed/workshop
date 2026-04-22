import { z } from "zod";

const configSchema = z.object({
  stage: z.enum(["local", "prod"]).default("local"),
  databaseUrl: z.string().min(1),
  sessionSecret: z.string().min(32),
  sesFromAddress: z.string().email(),
  awsRegion: z.string().default("us-east-1"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof configSchema> & { isLocal: boolean };

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = configSchema.parse({
    stage: process.env.STAGE,
    databaseUrl: process.env.DATABASE_URL,
    sessionSecret: process.env.SESSION_SECRET,
    sesFromAddress: process.env.SES_FROM_ADDRESS,
    awsRegion: process.env.AWS_REGION,
    logLevel: process.env.LOG_LEVEL,
  });
  cached = { ...parsed, isLocal: parsed.stage === "local" };
  return cached;
}

export function resetConfigForTesting() {
  cached = null;
}
