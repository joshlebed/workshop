// Centralized permissions helper (§5.2 of docs/list-data-model-redesign.md).
// One file owns the capability matrix; handlers ask for the capability they
// exercise and get a `403 Forbidden` with a stable shape on denial.

import type { MemberRole } from "@workshop/shared";
import type { Context } from "hono";
import { err } from "./response.js";

type Capability =
  | "view"
  | "edit_items"
  | "vote"
  | "complete"
  | "score"
  | "sync_source"
  | "duplicate"
  | "edit_list_metadata" // name/emoji/color/description/cover
  | "edit_modules"
  | "edit_item_kind"
  | "edit_sources"
  | "invite"
  | "remove_member"
  | "transfer_ownership"
  | "archive_list";

const OWNER_ONLY: ReadonlySet<Capability> = new Set<Capability>([
  "edit_list_metadata",
  "edit_modules",
  "edit_item_kind",
  "edit_sources",
  "invite",
  "remove_member",
  "transfer_ownership",
  "archive_list",
]);

function isCapabilityAllowed(role: MemberRole | null, capability: Capability): boolean {
  if (role === "owner") return true;
  if (role === "member") return !OWNER_ONLY.has(capability);
  // null role = not a member; everything denied (the caller should have run
  // requireListMember/requireItemMember already, which surfaces 404).
  return false;
}

/**
 * Returns null on success or a 403 Response to bubble up on denial. Callers
 * should `if (!ok) return ok` after the check.
 */
export function requireCapability(
  c: Context,
  role: MemberRole | null,
  capability: Capability,
): Response | null {
  if (isCapabilityAllowed(role, capability)) return null;
  return err(c, "FORBIDDEN", "permission_denied", {
    capability,
    role: role ?? null,
  });
}
