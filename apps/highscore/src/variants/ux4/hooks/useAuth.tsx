// Playground shim. The five UX variants each carry a full copy of HighScore's
// `src/` tree so their relative imports and clashing primitive names can
// coexist, but the auth context must be ONE React context: the root layout
// mounts a single `AuthProvider`, and a duplicated module would give every
// variant its own context (and its own session bootstrap). Re-export the
// shared implementation instead — it is byte-identical on all five branches.
export * from "../../../hooks/useAuth";
