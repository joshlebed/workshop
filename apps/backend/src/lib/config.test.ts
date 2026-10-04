import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appleAudiences, getConfig, googleAudiences, resetConfigForTesting } from "./config.js";

const AUDIENCE_ENV = [
  "APPLE_BUNDLE_ID",
  "APPLE_SERVICES_ID",
  "GOOGLE_IOS_CLIENT_ID",
  "GOOGLE_WEB_CLIENT_ID",
  "APPLE_EXTRA_AUDIENCES",
  "GOOGLE_EXTRA_AUDIENCES",
] as const;

function setBaseEnv() {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.AWS_REGION = "us-east-1";
  process.env.LOG_LEVEL = "error";
  for (const key of AUDIENCE_ENV) delete process.env[key];
  resetConfigForTesting();
}

beforeEach(setBaseEnv);
afterEach(setBaseEnv);

describe("audience config parsing", () => {
  it("treats a single value with no comma exactly as before (Workshop-only wiring)", () => {
    process.env.APPLE_BUNDLE_ID = "dev.josh.workshop";
    process.env.APPLE_SERVICES_ID = "dev.josh.workshop.web";
    process.env.GOOGLE_IOS_CLIENT_ID = "ios.client.id";
    process.env.GOOGLE_WEB_CLIENT_ID = "web.client.id";
    resetConfigForTesting();

    expect(appleAudiences()).toEqual(["dev.josh.workshop", "dev.josh.workshop.web"]);
    expect(googleAudiences()).toEqual(["ios.client.id", "web.client.id"]);
  });

  it("splits comma-separated lists so two client apps share one backend", () => {
    process.env.APPLE_BUNDLE_ID = "dev.josh.workshop,live.highscore.app";
    process.env.APPLE_SERVICES_ID = "dev.josh.workshop.web,live.highscore.web";
    process.env.GOOGLE_IOS_CLIENT_ID = "ios.client.id,highscore.ios.client.id";
    resetConfigForTesting();

    expect(appleAudiences()).toEqual([
      "dev.josh.workshop",
      "live.highscore.app",
      "dev.josh.workshop.web",
      "live.highscore.web",
    ]);
    expect(googleAudiences()).toEqual(["ios.client.id", "highscore.ios.client.id"]);
  });

  it("trims whitespace and drops empty entries from sloppy ops values", () => {
    process.env.APPLE_BUNDLE_ID = " dev.josh.workshop , , live.highscore.app ,";
    resetConfigForTesting();

    expect(getConfig().appleBundleIds).toEqual(["dev.josh.workshop", "live.highscore.app"]);
  });

  it("de-duplicates repeated audiences", () => {
    process.env.APPLE_BUNDLE_ID = "dev.josh.workshop,dev.josh.workshop";
    process.env.APPLE_EXTRA_AUDIENCES = "dev.josh.workshop";
    resetConfigForTesting();

    expect(appleAudiences()).toEqual(["dev.josh.workshop"]);
  });

  it("yields no audiences when the env vars are unset (local dev)", () => {
    expect(appleAudiences()).toEqual([]);
    expect(googleAudiences()).toEqual([]);
  });
});

describe("OpenAI teach config", () => {
  const OPENAI_ENV = [
    "OPENAI_API_KEY",
    "OPENAI_TEACH_TARGETS_MODEL",
    "OPENAI_TEACH_CODEGEN_MODEL",
  ] as const;
  const clear = () => {
    for (const key of OPENAI_ENV) delete process.env[key];
    resetConfigForTesting();
  };
  beforeEach(clear);
  afterEach(clear);

  it("boots with no key and defaults both step models", () => {
    const config = getConfig();
    expect(config.openaiApiKey).toBe("");
    expect(config.openaiTeachTargetsModel).toBe("gpt-6.1-sol");
    expect(config.openaiTeachCodegenModel).toBe("gpt-6.1-sol");
  });

  it("treats a blank dotenv value as unset", () => {
    process.env.OPENAI_TEACH_TARGETS_MODEL = "  ";
    resetConfigForTesting();
    expect(getConfig().openaiTeachTargetsModel).toBe("gpt-6.1-sol");
  });

  it("lets each step's model be overridden independently", () => {
    process.env.OPENAI_TEACH_CODEGEN_MODEL = "gpt-6-luna";
    resetConfigForTesting();
    expect(getConfig().openaiTeachTargetsModel).toBe("gpt-6.1-sol");
    expect(getConfig().openaiTeachCodegenModel).toBe("gpt-6-luna");
  });
});
