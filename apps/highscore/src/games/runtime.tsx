import type { User } from "@workshop/shared";
import { createContext, type ReactNode, useContext } from "react";

export type GamesAuthStatus =
  | "loading"
  | "unavailable"
  | "signed-out"
  | "needs-display-name"
  | "signed-in";

export interface GamesRoutes {
  root: string;
  home: string;
  signIn: string;
  friends: string;
  game: (gameId: string) => string;
  friendProfile: (userId: string, via?: string) => string;
}

export interface GamesRuntimeValue {
  token: string | null;
  user: User | null;
  status: GamesAuthStatus;
  appName: string;
  appScheme: string;
  routes: GamesRoutes;
}

const GamesRuntimeContext = createContext<GamesRuntimeValue | null>(null);

export function GamesRuntimeProvider({
  value,
  children,
}: {
  value: GamesRuntimeValue;
  children: ReactNode;
}) {
  return <GamesRuntimeContext.Provider value={value}>{children}</GamesRuntimeContext.Provider>;
}

export function useGamesRuntime(): GamesRuntimeValue {
  const value = useContext(GamesRuntimeContext);
  if (!value) throw new Error("useGamesRuntime must be used inside GamesRuntimeProvider");
  return value;
}
