import { describe, expect, it } from "vitest";
import {
  formatConfigWarning,
  hasModule,
  isModuleName,
  MODULE_NAMES,
  MODULE_REMOVAL_WARNINGS,
  normalizeModules,
} from "./modules.js";

describe("module-name helpers", () => {
  it("MODULE_NAMES contains the core five plus the reserved three (§3.10)", () => {
    expect([...MODULE_NAMES]).toEqual([
      "todo",
      "voting",
      "ranking",
      "leaderboard",
      "sources",
      "scheduling",
      "comments",
      "attachments",
    ]);
  });

  it("isModuleName accepts every registered name", () => {
    for (const m of MODULE_NAMES) expect(isModuleName(m)).toBe(true);
  });

  it("isModuleName rejects unknown values", () => {
    expect(isModuleName("made_up")).toBe(false);
    expect(isModuleName(42)).toBe(false);
    expect(isModuleName(null)).toBe(false);
  });

  it("normalizeModules dedups and preserves canonical order", () => {
    expect(normalizeModules(["voting", "voting", "todo"])).toEqual(["todo", "voting"]);
  });

  it("normalizeModules drops unknown names", () => {
    expect(normalizeModules(["voting", "made_up"])).toEqual(["voting"]);
  });

  it("hasModule", () => {
    expect(hasModule(["voting"], "voting")).toBe(true);
    expect(hasModule(["voting"], "todo")).toBe(false);
  });
});

describe("formatConfigWarning — per-code client copy", () => {
  it("todo: pluralizes correctly", () => {
    const one = formatConfigWarning({
      code: MODULE_REMOVAL_WARNINGS.todo,
      message: "server msg",
      affectedCount: 1,
    });
    expect(one.headline).toBe("Hide 1 completed item?");

    const many = formatConfigWarning({
      code: MODULE_REMOVAL_WARNINGS.todo,
      message: "server msg",
      affectedCount: 5,
    });
    expect(many.headline).toBe("Hide 5 completed items?");
    expect(many.detail).toMatch(/re-enable To-Do/);
  });

  it("voting: surfaces the safety net", () => {
    const out = formatConfigWarning({
      code: MODULE_REMOVAL_WARNINGS.voting,
      message: "server msg",
      affectedCount: 3,
    });
    expect(out.headline).toBe("Hide 3 upvotes?");
    expect(out.detail).toMatch(/preserved/);
  });

  it("ranking", () => {
    const out = formatConfigWarning({
      code: MODULE_REMOVAL_WARNINGS.ranking,
      message: "server msg",
      affectedCount: 2,
    });
    expect(out.headline).toBe("Drop the manual order from 2 items?");
  });

  it("leaderboard", () => {
    const out = formatConfigWarning({
      code: MODULE_REMOVAL_WARNINGS.leaderboard,
      message: "server msg",
      affectedCount: 7,
    });
    expect(out.headline).toBe("Hide 7 scores?");
  });

  it("sources", () => {
    const out = formatConfigWarning({
      code: MODULE_REMOVAL_WARNINGS.sources,
      message: "server msg",
      affectedCount: 1,
    });
    expect(out.headline).toBe("Stop syncing 1 attached source?");
  });

  it("falls back to the server message on unknown codes (forward compat)", () => {
    const out = formatConfigWarning({
      code: "future.module.warning",
      message: "Server-authored copy",
      affectedCount: 42,
    });
    expect(out.headline).toBe("Heads up");
    expect(out.detail).toBe("Server-authored copy");
  });

  it("treats a missing affectedCount as zero", () => {
    const out = formatConfigWarning({
      code: MODULE_REMOVAL_WARNINGS.voting,
      message: "x",
    });
    expect(out.headline).toBe("Hide 0 upvotes?");
  });
});
