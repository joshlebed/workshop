import { MODULE_REMOVAL_WARNINGS } from "@workshop/shared/modules";
import { describe, expect, it, vi } from "vitest";
import { inspectModuleChange } from "./moduleManifests.js";
import type { DbClient } from "./sql.js";

// Drizzle's query builder is a chain — `.select().from().where().innerJoin()…`
// — that we don't want to reach into. The inspect hooks all run a single
// COUNT query through that chain, so we mock the chain to return whatever
// row count we want.
function fakeDb(rowsByCallIndex: number[]): DbClient {
  let i = 0;
  const next = () => {
    const v = rowsByCallIndex[i] ?? 0;
    i += 1;
    return [{ count: v }];
  };
  const chain = () => {
    const obj = {
      from: vi.fn(() => obj),
      innerJoin: vi.fn(() => obj),
      where: vi.fn(() => Promise.resolve(next())),
    };
    return obj;
  };
  return {
    select: vi.fn(() => chain()),
  } as unknown as DbClient;
}

const LIST_ID = "00000000-0000-4000-8000-000000000001";

describe("inspectModuleChange — module removal warnings (§6)", () => {
  it("returns an empty array when no modules are removed", async () => {
    const db = fakeDb([0]);
    const warnings = await inspectModuleChange({
      listId: LIST_ID,
      currentModules: ["todo", "ranking"],
      nextModules: ["todo", "ranking", "sources"],
      db,
    });
    expect(warnings).toEqual([]);
  });

  it("emits no warning when removing a module that has zero associated rows", async () => {
    const db = fakeDb([0]);
    const warnings = await inspectModuleChange({
      listId: LIST_ID,
      currentModules: ["todo"],
      nextModules: [],
      db,
    });
    expect(warnings).toEqual([]);
  });

  it("emits a todo.hide_completed warning when removing todo leaves completed items behind", async () => {
    const db = fakeDb([3]);
    const warnings = await inspectModuleChange({
      listId: LIST_ID,
      currentModules: ["todo"],
      nextModules: [],
      db,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      code: MODULE_REMOVAL_WARNINGS.todo,
      message: "3 completed items will be hidden.",
      affectedCount: 3,
    });
  });

  it("uses singular grammar when the count is one", async () => {
    const db = fakeDb([1]);
    const warnings = await inspectModuleChange({
      listId: LIST_ID,
      currentModules: ["ranking"],
      nextModules: [],
      db,
    });
    expect(warnings[0]?.message).toBe("1 item will lose their manual order.");
  });

  it("emits one warning per removed module with data", async () => {
    const db = fakeDb([3, 5]);
    const warnings = await inspectModuleChange({
      listId: LIST_ID,
      currentModules: ["todo", "ranking"],
      nextModules: [],
      db,
    });
    expect(warnings.map((w) => w.code)).toEqual([
      MODULE_REMOVAL_WARNINGS.todo,
      MODULE_REMOVAL_WARNINGS.ranking,
    ]);
    expect(warnings.map((w) => w.affectedCount)).toEqual([3, 5]);
  });

  it("skips an unknown module name silently (forward compat)", async () => {
    const db = fakeDb([]);
    const warnings = await inspectModuleChange({
      listId: LIST_ID,
      currentModules: ["todo", "future_module"],
      nextModules: ["todo"],
      db,
    });
    expect(warnings).toEqual([]);
  });

  it("emits the sources warning when removing sources with attached rows", async () => {
    const db = fakeDb([2]);
    const warnings = await inspectModuleChange({
      listId: LIST_ID,
      currentModules: ["sources"],
      nextModules: [],
      db,
    });
    expect(warnings[0]).toEqual({
      code: MODULE_REMOVAL_WARNINGS.sources,
      message: "2 attached sources will stop syncing.",
      affectedCount: 2,
    });
  });

  it("emits nothing when removing a reserved module (no data yet)", async () => {
    // scheduling/comments/attachments register no-data inspectors today.
    const db = fakeDb([]);
    const warnings = await inspectModuleChange({
      listId: LIST_ID,
      currentModules: ["scheduling", "comments", "attachments"],
      nextModules: [],
      db,
    });
    expect(warnings).toEqual([]);
  });
});
