import { describe, expect, it, vi } from "vitest";

// viewDay.tsx imports `AppState` for the live-today refresh; vitest can't
// parse react-native's Flow source, so stub the one export it touches.
vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));

import { resolveViewDay } from "./viewDay";

describe("resolveViewDay", () => {
  it("defaults to today with no stored selection", () => {
    expect(resolveViewDay(null, "2026-09-19")).toBe("2026-09-19");
  });

  it("keeps a past selection made today", () => {
    expect(resolveViewDay({ date: "2026-09-15", anchorToday: "2026-09-19" }, "2026-09-19")).toBe(
      "2026-09-15",
    );
  });

  it("keeps today's selection", () => {
    expect(resolveViewDay({ date: "2026-09-19", anchorToday: "2026-09-19" }, "2026-09-19")).toBe(
      "2026-09-19",
    );
  });

  it("snaps to today after a day rollover", () => {
    // Picked "yesterday" last night; this morning that pick is stale.
    expect(resolveViewDay({ date: "2026-09-18", anchorToday: "2026-09-18" }, "2026-09-19")).toBe(
      "2026-09-19",
    );
  });

  it("never resolves to a future date", () => {
    expect(resolveViewDay({ date: "2026-09-20", anchorToday: "2026-09-19" }, "2026-09-19")).toBe(
      "2026-09-19",
    );
  });
});
