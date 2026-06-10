import { describe, expect, it, vi } from "vitest";
import { homeTabForPathname } from "./navigationPreferences";

vi.mock("./storage", () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

const cases: [string, string | null][] = [
  ["/", "lists"],
  ["/list/abc", "lists"],
  ["/list/abc/settings", "lists"],
  ["/create-list/type", "lists"],
  ["/profile", "lists"],
  ["/games", "games"],
  ["/games/game-1", "games"],
  ["/games/game-1?date=2026-06-10", "games"],
  ["/activity", null],
  ["/activity?from=games", null],
  ["/friends", null],
  ["/share", null],
];

describe("homeTabForPathname", () => {
  it.each(cases)("maps %s to %s", (pathname, tab) => {
    expect(homeTabForPathname(pathname)).toBe(tab);
  });
});
