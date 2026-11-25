import { describe, expect, it } from "vitest";
import { shareIntentSchema, widgetTelemetrySchema } from "./telemetry.js";

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

describe("widgetTelemetrySchema", () => {
  it("accepts each widget event with its optional context", () => {
    expect(
      widgetTelemetrySchema.safeParse({ event: "card_shown", source: "home-card" }).success,
    ).toBe(true);
    expect(
      widgetTelemetrySchema.safeParse({
        event: "widget_tap",
        family: "systemMedium",
        gameId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(
      widgetTelemetrySchema.safeParse({
        event: "snapshot_write",
        writes: 3,
        gameCount: 4,
        playedCount: 2,
        runtimeVersion: "1.4.0",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown event and a non-uuid game id", () => {
    expect(widgetTelemetrySchema.safeParse({ event: "installed" }).success).toBe(false);
    expect(widgetTelemetrySchema.safeParse({ event: "widget_tap", gameId: "wordle" }).success).toBe(
      false,
    );
  });
});
