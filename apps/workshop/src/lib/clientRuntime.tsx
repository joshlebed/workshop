import type { User } from "@workshop/shared";
import { createContext, type ReactNode, useContext } from "react";

export type ClientAuthStatus =
  | "loading"
  | "unavailable"
  | "signed-out"
  | "needs-display-name"
  | "signed-in";

export interface ClientRoutes {
  root: string;
  home: string;
  signIn: string;
  friends: string;
  /** Per-game board; `date` (YYYY-MM-DD) preselects that day on its rail. */
  game: (gameId: string, date?: string) => string;
  friendProfile: (userId: string, via?: string) => string;
}

export interface ClientRuntimeValue {
  token: string | null;
  user: User | null;
  status: ClientAuthStatus;
  appName: string;
  appScheme: string;
  routes: ClientRoutes;
}

const ClientRuntimeContext = createContext<ClientRuntimeValue | null>(null);

export function ClientRuntimeProvider({
  value,
  children,
}: {
  value: ClientRuntimeValue;
  children: ReactNode;
}) {
  return <ClientRuntimeContext.Provider value={value}>{children}</ClientRuntimeContext.Provider>;
}

export function useClientRuntime(): ClientRuntimeValue {
  const value = useContext(ClientRuntimeContext);
  if (!value) throw new Error("useClientRuntime must be used inside ClientRuntimeProvider");
  return value;
}
