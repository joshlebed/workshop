// The playground's own palette.
//
// Straight from DESIGN.md's dark-only table, inlined rather than imported from
// any variant's `theme/tokens.ts`: the five variants spend these tokens very
// differently, and the review chrome has to look the same in all five so it
// never flatters one of them. Used by the UX chip and the root auth
// interstitials — nothing a variant draws.
export const CHROME = {
  ink: "#121216",
  surface1: "#1C1528",
  surface2: "#251B36",
  surface3: "#2F2244",
  border: "#3D2E55",
  primary: "#FF3D9A",
  textPrimary: "#F2EFFA",
  textSecondary: "#A99EC2",
  bezel: 2,
} as const;
