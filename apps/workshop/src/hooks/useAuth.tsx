import type { User } from "@workshop/shared";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/client";
import { clearSession, loadSession, saveSession } from "../lib/storage";

interface AuthState {
  user: User | null;
  ready: boolean;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await loadSession();
      if (!token) {
        setReady(true);
        return;
      }
      try {
        // Validate by hitting the server. For now we don't have a /me route,
        // so we trust the token until the next request fails.
        setUser({ id: "cached", email: "cached", createdAt: new Date().toISOString() });
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const value: AuthState = {
    user,
    ready,
    requestCode: async (email) => {
      await api.requestMagicLink({ email });
    },
    verifyCode: async (email, code) => {
      const res = await api.verifyMagicLink({ email, code });
      await saveSession(res.sessionToken);
      setUser(res.user);
    },
    signOut: async () => {
      await clearSession();
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
