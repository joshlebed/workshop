import type { MemberRole } from "@workshop/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireCapability } from "./permissions.js";

type Cap = Parameters<typeof requireCapability>[2];

function capApp(role: MemberRole | null, cap: Cap) {
  const app = new Hono();
  app.post("/probe", (c) => {
    const denied = requireCapability(c, role, cap);
    if (denied) return denied;
    return c.json({ ok: true });
  });
  return app;
}

async function status(role: MemberRole | null, cap: Cap): Promise<number> {
  const app = capApp(role, cap);
  const res = await app.request("/probe", { method: "POST" });
  return res.status;
}

const ALL_MEMBER_CAPS: Cap[] = [
  "view",
  "edit_items",
  "vote",
  "complete",
  "score",
  "sync_source",
  "duplicate",
];

const OWNER_ONLY_CAPS: Cap[] = [
  "edit_list_metadata",
  "edit_modules",
  "edit_item_kind",
  "edit_sources",
  "invite",
  "remove_member",
  "transfer_ownership",
  "archive_list",
];

describe("requireCapability — §5.2 matrix", () => {
  it("owner is allowed every capability", async () => {
    for (const cap of [...ALL_MEMBER_CAPS, ...OWNER_ONLY_CAPS]) {
      expect(await status("owner", cap)).toBe(200);
    }
  });

  it("member is allowed shared capabilities", async () => {
    for (const cap of ALL_MEMBER_CAPS) {
      expect(await status("member", cap)).toBe(200);
    }
  });

  it("member is denied every owner-only capability", async () => {
    for (const cap of OWNER_ONLY_CAPS) {
      expect(await status("member", cap)).toBe(403);
    }
  });

  it("null role (non-member) is denied everything", async () => {
    for (const cap of [...ALL_MEMBER_CAPS, ...OWNER_ONLY_CAPS]) {
      expect(await status(null, cap)).toBe(403);
    }
  });

  it("403 body carries the capability + role for client-side copy", async () => {
    const app = capApp("member", "edit_modules");
    const res = await app.request("/probe", { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      code: string;
      details: { capability: string; role: string | null };
    };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.details).toEqual({ capability: "edit_modules", role: "member" });
  });

  it("403 body for a non-member surfaces role=null", async () => {
    const app = capApp(null, "edit_items");
    const res = await app.request("/probe", { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { details: { role: string | null } };
    expect(body.details.role).toBeNull();
  });
});
