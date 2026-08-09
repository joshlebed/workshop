import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "1.2.3" } },
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

let apiRequest: typeof import("./api").apiRequest;
let registerSessionRefreshHandler: typeof import("./api").registerSessionRefreshHandler;

beforeAll(async () => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.example.test";
  ({ apiRequest, registerSessionRefreshHandler } = await import("./api"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest managed-session retry", () => {
  it("refreshes once after a 401 and retries with the new access token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "expired", code: "UNAUTHORIZED" }), { status: 401 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => "fresh-access");
    const unregister = registerSessionRefreshHandler(refresh);

    await expect(
      apiRequest<{ ok: boolean }>({ method: "GET", path: "/v1/example", token: "expired-access" }),
    ).resolves.toEqual({ ok: true });

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(firstInit.credentials).toBe("include");
    expect((firstInit.headers as Record<string, string>)["X-Workshop-Session-Version"]).toBe("2");
    expect((retryInit.headers as Record<string, string>).Authorization).toBe("Bearer fresh-access");
    unregister();
  });

  it("does not recurse when auth retry is disabled", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "expired", code: "UNAUTHORIZED" }), { status: 401 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => "fresh-access");
    const unregister = registerSessionRefreshHandler(refresh);

    await expect(
      apiRequest({
        method: "POST",
        path: "/v1/auth/refresh",
        token: "expired-access",
        authRetry: false,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
    unregister();
  });
});
