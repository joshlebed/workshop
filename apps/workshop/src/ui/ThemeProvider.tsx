import { createContext, type ReactNode, useMemo } from "react";
import { useColorScheme } from "react-native";
import { darkTokens, lightTokens, type Tokens } from "./theme";

// Default value falls through to dark so primitives rendered outside a
// provider (tests, isolated stories) keep their current look.
export const ThemeContext = createContext<Tokens>(darkTokens);

export interface ThemeProviderProps {
  children: ReactNode;
  // Override for tests / Storybook. When set, ignores `useColorScheme()`.
  forceScheme?: "light" | "dark";
}

export function ThemeProvider({ children, forceScheme }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const scheme = forceScheme ?? (systemScheme === "light" ? "light" : "dark");
  // Memoize so context consumers don't re-render unless the resolved
  // palette actually changes — useColorScheme() can re-fire with the same
  // value during transitions.
  const value = useMemo(() => (scheme === "light" ? lightTokens : darkTokens), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
