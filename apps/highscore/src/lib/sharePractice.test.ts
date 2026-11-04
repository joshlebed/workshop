import { describe, expect, it } from "vitest";
import { markSharePracticeReceived } from "./sharePractice";

describe("markSharePracticeReceived", () => {
  it("can be called with no walkthrough listening", () => {
    expect(() => markSharePracticeReceived(1_000)).not.toThrow();
  });
});
