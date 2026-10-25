import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { apiUrl: "https://api.example.test" } } },
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const { userAvatarImageUrl } = await import("./avatar.js");

describe("userAvatarImageUrl", () => {
  it("returns null without a user id", () => {
    expect(userAvatarImageUrl(null)).toBeNull();
    expect(userAvatarImageUrl(undefined)).toBeNull();
  });

  it("returns the bare endpoint when the caller has no version to hand", () => {
    expect(userAvatarImageUrl("u1")).toMatch(/\/v1\/users\/u1\/avatar$/);
  });

  it("returns null for a known no-picture user so no 404 is fetched", () => {
    expect(userAvatarImageUrl("u1", null)).toBeNull();
  });

  it("keys the URL on the version so a changed picture is a new URL", () => {
    const a = userAvatarImageUrl("u1", "0a1b2c3d");
    const b = userAvatarImageUrl("u1", "ffffffff");
    expect(a).toMatch(/\/v1\/users\/u1\/avatar\?v=0a1b2c3d$/);
    expect(a).not.toBe(b);
  });
});
