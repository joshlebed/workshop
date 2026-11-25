import { describe, expect, it } from "vitest";
import { setupChecklistEventSchema, shareIntentSchema } from "./telemetry.js";

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

describe("setupChecklistEventSchema", () => {
  it("accepts each event shape the card sends", () => {
    for (const body of [
      { event: "shown", doneCount: 1, total: 6, minutesSinceSignup: 3, platform: "ios" },
      { event: "row_tapped", row: "games", minutesSinceSignup: 4 },
      { event: "row_completed", row: "friend2", minutesSinceSignup: 12 },
      { event: "dismissed", doneCount: 2, total: 4 },
      { event: "completed", minutesSinceSignup: 30 },
      { event: "retired", reason: "expired", doneCount: 3, total: 6 },
    ]) {
      expect(setupChecklistEventSchema.safeParse(body).success).toBe(true);
    }
  });

  it("rejects unknown events, rows and reasons", () => {
    expect(setupChecklistEventSchema.safeParse({ event: "clicked" }).success).toBe(false);
    expect(setupChecklistEventSchema.safeParse({ event: "row_tapped", row: "x" }).success).toBe(
      false,
    );
    expect(setupChecklistEventSchema.safeParse({ event: "retired", reason: "bored" }).success).toBe(
      false,
    );
    expect(
      setupChecklistEventSchema.safeParse({ event: "shown", minutesSinceSignup: -1 }).success,
    ).toBe(false);
  });
});
