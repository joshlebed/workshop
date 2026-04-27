import type { AuthResponse, User } from "@workshop/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest } from "../lib/api";
import { getItem, removeItem, setItem } from "../lib/storage";

const TOKEN_KEY = "workshop.session.v1";
const AUTO_DEV_OPT_OUT_KEY = "workshop.disable-auto-dev";

export type AuthStatus = "loading" | "signed-out" | "needs-display-name" | "signed-in";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  token: string | null;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  signInWithApple: (req: {
    identityToken: string;
    nonce?: string;
    email?: string;
    fullName?: string;
  }) => Promise<void>;
  signInWithGoogle: (req: { idToken: string }) => Promise<void>;
  signInDev: (req: { email: string; displayName?: string | null }) => Promise<void>;
  signOut: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function statusFor(user: User | null): AuthStatus {
  if (!user) return "signed-out";
  return user.displayName ? "signed-in" : "needs-display-name";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    user: null,
    token: null,
  });

  const applyAuth = useCallback(async (res: AuthResponse) => {
    await setItem(TOKEN_KEY, res.token);
    setState({
      status: res.needsDisplayName ? "needs-display-name" : "signed-in",
      user: res.user,
      token: res.token,
    });
  }, []);

  const autoDevSignIn = useCallback(async (): Promise<boolean> => {
    if (process.env.EXPO_PUBLIC_DEV_AUTH !== "1") return false;
    // Tests opt out of the boot-time auto-sign-in so the sign-in screen
    // renders for OAuth-button assertions.
    if ((await getItem(AUTO_DEV_OPT_OUT_KEY)) === "1") return false;
    try {
      const res = await apiRequest<AuthResponse>({
        method: "POST",
        path: "/v1/auth/dev",
        body: { email: "preview@workshop.local", displayName: "Preview User" },
      });
      await applyAuth(res);
      return true;
    } catch (e) {
      console.warn("auto dev sign-in failed", e);
      return false;
    }
  }, [applyAuth]);

  const bootstrap = useCallback(async () => {
    const token = await getItem(TOKEN_KEY);
    if (!token) {
      if (await autoDevSignIn()) return;
      setState({ status: "signed-out", user: null, token: null });
      return;
    }
    try {
      const me = await apiRequest<{ user: User }>({
        method: "GET",
        path: "/v1/auth/me",
        token,
      });
      setState({ status: statusFor(me.user), user: me.user, token });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
        await removeItem(TOKEN_KEY);
        if (await autoDevSignIn()) return;
        setState({ status: "signed-out", user: null, token: null });
        return;
      }
      throw e;
    }
  }, [autoDevSignIn]);

  useEffect(() => {
    bootstrap().catch((e) => {
      console.error("auth bootstrap failed", e);
      setState({ status: "signed-out", user: null, token: null });
    });
  }, [bootstrap]);

  const signInWithApple = useCallback<AuthContextValue["signInWithApple"]>(
    async (req) => {
      const res = await apiRequest<AuthResponse>({
        method: "POST",
        path: "/v1/auth/apple",
        body: req,
      });
      await applyAuth(res);
    },
    [applyAuth],
  );

  const signInWithGoogle = useCallback<AuthContextValue["signInWithGoogle"]>(
    async (req) => {
      const res = await apiRequest<AuthResponse>({
        method: "POST",
        path: "/v1/auth/google",
        body: req,
      });
      await applyAuth(res);
    },
    [applyAuth],
  );

  const signInDev = useCallback<AuthContextValue["signInDev"]>(
    async (req) => {
      const res = await apiRequest<AuthResponse>({
        method: "POST",
        path: "/v1/auth/dev",
        body: req,
      });
      await applyAuth(res);
    },
    [applyAuth],
  );

  const signOut = useCallback(async () => {
    const token = state.token;
    try {
      if (token) {
        await apiRequest({ method: "POST", path: "/v1/auth/signout", token });
      }
    } catch {
      // stateless HMAC session — local clear is sufficient even if the request fails
    }
    await removeItem(TOKEN_KEY);
    setState({ status: "signed-out", user: null, token: null });
  }, [state.token]);

  const setDisplayName = useCallback<AuthContextValue["setDisplayName"]>(
    async (name) => {
      const token = state.token;
      if (!token) throw new Error("not signed in");
      const res = await apiRequest<{ user: User }>({
        method: "PATCH",
        path: "/v1/users/me",
        body: { displayName: name },
        token,
      });
      setState({ status: statusFor(res.user), user: res.user, token });
    },
    [state.token],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      token: state.token,
      signInWithApple,
      signInWithGoogle,
      signInDev,
      signOut,
      setDisplayName,
      refresh: bootstrap,
    }),
    [state, signInWithApple, signInWithGoogle, signInDev, signOut, setDisplayName, bootstrap],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
