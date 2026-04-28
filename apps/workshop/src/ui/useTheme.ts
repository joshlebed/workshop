import { useContext } from "react";
import { ThemeContext } from "./ThemeProvider";
import type { Tokens } from "./theme";

// Returns the active resolved tokens — `darkTokens` or `lightTokens`
// depending on `useColorScheme()` (driven by `<ThemeProvider />`).
// Falls back to `darkTokens` outside a provider, matching the legacy
// static `tokens` export so unwrapped renderers don't blank out.
export function useTheme(): Tokens {
  return useContext(ThemeContext);
}
