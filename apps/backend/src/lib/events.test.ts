import type { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { recordEvent } from "./events.js";

type SqlQuery = ReturnType<typeof sql>;

function fakeDb() {
  return { execute: vi.fn(async (_q: SqlQuery) => [] as Array<Record<string, unknown>>) };
}

/**
 * Drizzle's tagged-template SQL helper interleaves string fragments,
 * table refs, and positional params inside `queryChunks`. Pull out the
 * primitive values (strings / numbers / null / JSON-stringified
 * objects) — that's the bound parameters in the order they appear.
 */
function extractParams(q: SqlQuery): unknown[] {
  const chunks = (q as unknown as { queryChunks: unknown[] }).queryChunks;
  return chunks.filter((c) => {
    if (c === null) return true;
    const t = typeof c;
    return t === "string" || t === "number" || t === "boolean";
  });
}

const listId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const itemId = "00000000-0000-4000-8000-000000000003";

describe("recordEvent", () => {
  it("issues exactly one execute call per event", async () => {
    const db = fakeDb();
    await recordEvent({ db, listId, actorId, type: "list_created" });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("defaults itemId to null and payload to {}", async () => {
    const db = fakeDb();
    await recordEvent({ db, listId, actorId, type: "list_created" });
    const call = db.execute.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    if (!call) return;
    const params = extractParams(call);
    expect(params).toEqual([listId, actorId, "list_created", null, "{}"]);
  });

  it("forwards a non-empty payload as JSON text and an itemId", async () => {
    const db = fakeDb();
    await recordEvent({
      db,
      listId,
      actorId,
      type: "item_added",
      itemId,
      payload: { title: "Dune" },
    });
    const call = db.execute.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    if (!call) return;
    const params = extractParams(call);
    expect(params).toEqual([
      listId,
      actorId,
      "item_added",
      itemId,
      JSON.stringify({ title: "Dune" }),
    ]);
  });

  it("accepts every enum value", async () => {
    const db = fakeDb();
    const types = [
      "list_created",
      "member_joined",
      "member_left",
      "member_removed",
      "item_added",
      "item_updated",
      "item_deleted",
      "item_upvoted",
      "item_unupvoted",
      "item_completed",
      "item_uncompleted",
      "invite_created",
      "invite_revoked",
    ] as const;
    for (const type of types) {
      await recordEvent({ db, listId, actorId, type });
    }
    expect(db.execute).toHaveBeenCalledTimes(types.length);
  });
});
