import { vi } from "vitest";

// The auth middleware now consults the DB-backed `sessionRevocation` helper
// on every authenticated request. Route tests sign tokens directly with
// `signSession()` and expect to land in the route handler (or its input
// validation) without a live database — so default the helper to "not
// revoked" globally. Tests that exercise revocation behavior (e.g.
// auth.test.ts, sessionRevocation.test.ts) re-mock the module locally with
// their own implementations.
vi.mock("./lib/sessionRevocation.js", () => ({
  isSessionRevoked: vi.fn(async () => false),
  revokeAllSessions: vi.fn(async () => undefined),
}));
