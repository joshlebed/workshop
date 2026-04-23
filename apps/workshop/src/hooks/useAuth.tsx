import type { User } from "@workshop/shared";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { ApiError, api, setOnUnauthorized } from "../api/client";
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
    setOnUnauthorized(async () => {
      await clearSession();
      setUser(null);
    });
    return () => setOnUnauthorized(null);
  }, []);

  useEffect(() => {
    (async () => {
      const token = await loadSession();
      if (!token) {
        setReady(true);
        return;
      }
      try {
        const res = await api.me();
        setUser(res.user);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await clearSession();
        } else {
          console.warn("[auth] failed to validate cached session", { error: e });
        }
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
