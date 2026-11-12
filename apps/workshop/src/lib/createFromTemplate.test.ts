import { getTemplate } from "@workshop/shared/templates";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-router", () => ({ router: { dismissTo: vi.fn(), push: vi.fn() } }));
const { addSurfaceHref, templateCreateRequest } = await import("./createFromTemplate");

describe("one-tap create (4.2, 4.3)", () => {
  it("makes a ready list from the template's defaults", () => {
    const req = templateCreateRequest(getTemplate("movie_watchlist")!);
    expect(req).toMatchObject({
      name: "Movies to watch",
      emoji: "🎬",
      color: "sunset",
      itemKind: "movie",
      modules: ["todo"],
    });
    expect(req.sources).toBeUndefined();
  });

  it("takes Customize's choices, falling back to the template name for a blank one", () => {
    const req = templateCreateRequest(getTemplate("date_ideas")!, {
      name: "  ",
      emoji: "🌮",
      description: " Fridays ",
    });
    expect(req.name).toBe("Date ideas");
    expect(req.emoji).toBe("🌮");
    expect(req.description).toBe("Fridays");
  });

  it("attaches an automatic source", () => {
    const req = templateCreateRequest(getTemplate("letterboxd_match")!);
    expect(req.sources).toEqual([{ kind: "letterboxd_match", config: {} }]);
  });

  it("builds the add surface link with a carried share", () => {
    expect(addSurfaceHref("L1")).toBe("/list/L1/add");
    expect(addSurfaceHref("L1", { prefillUrl: "https://e.com/a b", from: "share" })).toBe(
      "/list/L1/add?prefillUrl=https%3A%2F%2Fe.com%2Fa+b&from=share",
    );
  });
});
