// HighScore's auth context. Slimmed clone of apps/workshop's — same managed
// session machinery (it all lives in @workshop/api-client), minus the
// Workshop-only surfaces (Letterboxd). Both apps talk to the same backend and
// the same `user_identities` rows, so signing in here with the Apple ID used
// on Workshop resolves to one account.

import { ApiError, apiRequest, registerSessionRefreshHandler } from "@workshop/api-client/api";
import { resolveBootstrapSession } from "@workshop/api-client/authBootstrap";
import {
  clearSessionCredentials,
  persistSessionCredentials,
  readSessionCredentials,
} from "@workshop/api-client/sessionCredentials";
import { getItem } from "@workshop/api-client/storage";
import type { AuthImpersonation, AuthResponse, UpdateMeRequest, User } from "@workshop/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const AUTO_DEV_OPT_OUT_KEY = "highscore.disable-auto-dev";
const DEV_USER = { email: "joshlebed@gmail.com", displayName: "Josh" } as const;

export type AuthStatus =
  | "loading"
  | "unavailable"
  | "signed-out"
  | "needs-display-name"
  | "signed-in";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  impersonation: AuthImpersonation | null;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  impersonation: AuthImpersonation | null;
  signInWithApple: (req: {
    identityToken: string;
    nonce?: string;
    email?: string;
    fullName?: string;
  }) => Promise<void>;
  signInWithGoogle: (req: { idToken: string }) => Promise<void>;
  signInDev: (req: { email: string; displayName?: string | null }) => Promise<void>;
  impersonateUser: (target: string) => Promise<User>;
  stopImpersonating: () => Promise<User>;
  signOut: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  /** Patch the signed-in user's profile (display name and/or avatar). */
  updateProfile: (patch: UpdateMeRequest) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function statusFor(user: User | null): AuthStatus {
  if (!user) return "signed-out";
  return user.displayName ? "signed-in" : "needs-display-name";
}

function hasApiStatus(error: unknown, ...statuses: number[]): boolean {
  return error instanceof ApiError && statuses.includes(error.status);
}

async function requestManagedRefresh(refreshToken: string | null): Promise<AuthResponse> {
  return apiRequest<AuthResponse>({
    method: "POST",
    path: "/v1/auth/refresh",
    ...(refreshToken ? { body: { refreshToken } } : {}),
    authRetry: false,
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    user: null,
    token: null,
    impersonation: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyAuth = useCallback(async (res: AuthResponse) => {
    await persistSessionCredentials(res);
    setState({
      status: res.needsDisplayName ? "needs-display-name" : "signed-in",
      user: res.user,
      token: res.token,
      impersonation: res.impersonation ?? null,
    });
  }, []);

  const refreshManagedSession = useCallback(async (): Promise<AuthResponse | null> => {
    const credentials = await readSessionCredentials();
    if (!credentials.canRefresh) return null;
    const response = await requestManagedRefresh(credentials.refreshToken);
    await applyAuth(response);
    return response;
  }, [applyAuth]);

  const refreshAccessToken = useCallback(
    async (failedToken: string): Promise<string | null> => {
      const currentToken = stateRef.current.token;
      if (currentToken && currentToken !== failedToken) return currentToken;
      try {
        return (await refreshManagedSession())?.token ?? null;
      } catch (error) {
        if (hasApiStatus(error, 401)) {
          await clearSessionCredentials();
          setState({ status: "signed-out", user: null, token: null, impersonation: null });
          return null;
        }
        // A network/server failure is not evidence that the credential is bad.
        // Preserve it and let the original request surface a retryable error.
        throw error;
      }
    },
    [refreshManagedSession],
  );

  useEffect(() => registerSessionRefreshHandler(refreshAccessToken), [refreshAccessToken]);

  const autoDevSignIn = useCallback(async (): Promise<boolean> => {
    if (process.env.EXPO_PUBLIC_DEV_AUTH !== "1") return false;
    // Tests opt out of the boot-time auto-sign-in so the sign-in screen
    // renders for OAuth-button assertions.
    if ((await getItem(AUTO_DEV_OPT_OUT_KEY)) === "1") return false;
    try {
      const res = await apiRequest<AuthResponse>({
        method: "POST",
        path: "/v1/auth/dev",
        body: DEV_USER,
      });
      await applyAuth(res);
      return true;
    } catch (e) {
      console.warn("auto dev sign-in failed", e);
      return false;
    }
  }, [applyAuth]);

  const bootstrap = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading" }));
    let credentials: Awaited<ReturnType<typeof readSessionCredentials>> = {
      accessToken: null,
      refreshToken: null,
      canRefresh: false,
    };
    try {
      credentials = await readSessionCredentials();
      const resolved = await resolveBootstrapSession(credentials, {
        refresh: requestManagedRefresh,
        upgrade: (accessToken) =>
          apiRequest<AuthResponse>({
            method: "POST",
            path: "/v1/auth/session",
            token: accessToken,
            authRetry: false,
          }),
        readLegacyMe: (accessToken) =>
          apiRequest({
            method: "GET",
            path: "/v1/auth/me",
            token: accessToken,
            authRetry: false,
          }),
      });
      if (resolved.kind === "authenticated") {
        await applyAuth(resolved.response);
        return;
      }
      if (resolved.kind === "legacy") {
        setState({
          status: statusFor(resolved.me.user),
          user: resolved.me.user,
          token: resolved.accessToken,
          impersonation: resolved.me.impersonation ?? null,
        });
        return;
      }

      await clearSessionCredentials();
      if (await autoDevSignIn()) return;
      setState({ status: "signed-out", user: null, token: null, impersonation: null });
    } catch (error) {
      console.error("auth bootstrap failed", error);
      // A transient bootstrap failure must NOT clear stored credentials — only
      // an explicit auth rejection may. See docs/decisions.md.
      setState({
        status: "unavailable",
        user: null,
        token: credentials.accessToken,
        impersonation: null,
      });
    }
  }, [applyAuth, autoDevSignIn]);

  useEffect(() => {
    void bootstrap();
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

  const impersonateUser = useCallback<AuthContextValue["impersonateUser"]>(
    async (target) => {
      const token = state.token;
      if (!token) throw new Error("not signed in");
      const res = await apiRequest<AuthResponse>({
        method: "POST",
        path: "/v1/auth/impersonate",
        body: { target },
        token,
      });
      await applyAuth(res);
      return res.user;
    },
    [applyAuth, state.token],
  );

  const stopImpersonating = useCallback<AuthContextValue["stopImpersonating"]>(async () => {
    const token = state.token;
    if (!token) throw new Error("not signed in");
    const res = await apiRequest<AuthResponse>({
      method: "POST",
      path: "/v1/auth/impersonation/stop",
      token,
    });
    await applyAuth(res);
    return res.user;
  }, [applyAuth, state.token]);

  const signOut = useCallback(async () => {
    const token = state.token;
    try {
      if (token) {
        await apiRequest({ method: "POST", path: "/v1/auth/signout", token });
      }
    } catch {
      // Preserve the product action even when offline. Web records an explicit
      // signed-out marker so an uncleared HttpOnly cookie cannot sign back in.
    }
    await clearSessionCredentials();
    setState({ status: "signed-out", user: null, token: null, impersonation: null });
  }, [state.token]);

  const updateProfile = useCallback<AuthContextValue["updateProfile"]>(
    async (patch) => {
      const token = state.token;
      if (!token) throw new Error("not signed in");
      const res = await apiRequest<{ user: User }>({
        method: "PATCH",
        path: "/v1/users/me",
        body: patch,
        token,
      });
      setState((current) => ({
        status: statusFor(res.user),
        user: res.user,
        token: current.token,
        impersonation: current.impersonation,
      }));
    },
    [state.token],
  );

  const setDisplayName = useCallback<AuthContextValue["setDisplayName"]>(
    (name) => updateProfile({ displayName: name }),
    [updateProfile],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      token: state.token,
      impersonation: state.impersonation,
      signInWithApple,
      signInWithGoogle,
      signInDev,
      impersonateUser,
      stopImpersonating,
      signOut,
      setDisplayName,
      updateProfile,
      refresh: bootstrap,
    }),
    [
      state,
      signInWithApple,
      signInWithGoogle,
      signInDev,
      impersonateUser,
      stopImpersonating,
      signOut,
      setDisplayName,
      updateProfile,
      bootstrap,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
