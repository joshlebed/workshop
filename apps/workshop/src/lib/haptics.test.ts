import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));

import * as Haptics from "expo-haptics";
import { haptics } from "./haptics";

describe("haptics", () => {
  beforeEach(() => {
    vi.mocked(Haptics.impactAsync).mockClear();
    vi.mocked(Haptics.notificationAsync).mockClear();
  });

  it("light() dispatches Light impact", () => {
    haptics.light();
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
  });

  it("medium() dispatches Medium impact", () => {
    haptics.medium();
    expect(Haptics.impactAsync).toHaveBeenCalledWith("medium");
  });

  it("success() dispatches Success notification", () => {
    haptics.success();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("warning() dispatches Warning notification", () => {
    haptics.warning();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning");
  });

  it("swallows rejected impact promises", async () => {
    vi.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error("nope"));
    expect(() => haptics.light()).not.toThrow();
    await Promise.resolve();
  });
});
