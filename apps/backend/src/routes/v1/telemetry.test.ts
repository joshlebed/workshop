import { describe, expect, it } from "vitest";
import { preloginScoreSchema, shareIntentSchema } from "./telemetry.js";

describe("shareIntentSchema", () => {
  it("accepts a minimal valid snapshot", () => {
    const r = shareIntentSchema.safeParse({
      hasWebUrl: true,
      webUrlLen: 34,
      hasText: false,
      textLen: 0,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a full snapshot with previews and meta", () => {
    const r = shareIntentSchema.safeParse({
      source: "layout-redirect",
      type: "weburl",
      hasWebUrl: true,
      webUrlLen: 34,
      hasText: true,
      textLen: 88,
      textPreview: "DailyTens #756\n🏆🏆",
      webUrlPreview: "https://dailytens.com/?ref=944415",
      fileCount: 0,
      metaKeys: ["title"],
      runtimeVersion: "0.4.0",
      updateId: "abc123",
    });
    expect(r.success).toBe(true);
  });

  it("requires the boolean/length fields", () => {
    expect(shareIntentSchema.safeParse({ hasWebUrl: true }).success).toBe(false);
    expect(shareIntentSchema.safeParse({}).success).toBe(false);
  });

  it("rejects negative lengths", () => {
    expect(
      shareIntentSchema.safeParse({ hasWebUrl: true, webUrlLen: -1, hasText: false, textLen: 0 })
        .success,
    ).toBe(false);
  });

  it("caps preview length so we never store a wall of text", () => {
    const r = shareIntentSchema.safeParse({
      hasWebUrl: false,
      webUrlLen: 0,
      hasText: true,
      textLen: 5000,
      textPreview: "x".repeat(5000),
    });
    expect(r.success).toBe(false);
  });
});

describe("preloginScoreSchema", () => {
  it("accepts each funnel event with its optional fields", () => {
    expect(
      preloginScoreSchema.safeParse({
        event: "draft_created",
        draftId: "d_123",
        linkKind: "play",
        gameKey: "maptap",
        sharerPlayed: true,
        platform: "web",
      }).success,
    ).toBe(true);
    expect(
      preloginScoreSchema.safeParse({
        event: "draft_abandoned",
        draftId: "d_123",
        reason: "expired",
        ageMs: 90_000_000,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown event", () => {
    expect(preloginScoreSchema.safeParse({ event: "score_text" }).success).toBe(false);
  });

  it("has no field for score text", () => {
    const r = preloginScoreSchema.safeParse({ event: "draft_created", scoreRaw: "secret" });
    expect(r.success && "scoreRaw" in r.data).toBe(false);
  });
});
