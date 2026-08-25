import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { apiUrl: "https://api.example.test" } } },
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

async function apiUrlAt(hostname: string): Promise<string> {
  vi.resetModules();
  vi.stubGlobal("window", {
    location: { hostname, port: "", protocol: "https:" },
  });
  return (await import("./config.js")).API_URL;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API_URL on hosted web origins", () => {
  it("uses the same-origin proxy on Cloudflare Pages", async () => {
    await expect(apiUrlAt("highscore.pages.dev")).resolves.toBe("/api");
  });

  it("uses the same-origin proxy on the HighScore custom domain", async () => {
    await expect(apiUrlAt("highscore.live")).resolves.toBe("/api");
  });

  it("keeps unrelated custom domains on the configured API origin", async () => {
    await expect(apiUrlAt("example.test")).resolves.toBe("https://api.example.test");
  });
});
