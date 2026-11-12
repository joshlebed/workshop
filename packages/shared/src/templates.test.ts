import { describe, expect, it } from "vitest";
import {
  getTemplate,
  groupTemplates,
  LIST_TEMPLATES,
  TEMPLATE_GROUPS,
  templateListName,
} from "./templates";

describe("list templates (UX pass 4.3)", () => {
  it("puts Blank first", () => {
    expect(LIST_TEMPLATES[0]?.id).toBe("blank_list");
  });

  it("uses sentence case for every name", () => {
    for (const t of LIST_TEMPLATES) {
      const [first, ...rest] = t.displayName.split(" ");
      expect(first?.[0]).toBe(first?.[0]?.toUpperCase());
      // Later words are lower case unless they are a proper noun.
      for (const word of rest) {
        if (["TV", "Letterboxd", "Spotify"].includes(word)) continue;
        expect(word).toBe(word.toLowerCase());
      }
    }
  });

  it("groups in picker order with every template placed once", () => {
    const groups = groupTemplates();
    expect(groups.map((g) => g.title)).toEqual([
      "Start simple",
      "Watch and read",
      "Plans",
      "Import",
    ]);
    expect(groups[0]?.templates.map((t) => t.id)).toEqual(["blank_list", "shared_todo"]);
    expect(groups.flatMap((g) => g.templates).length).toBe(LIST_TEMPLATES.length);
    expect(TEMPLATE_GROUPS.length).toBe(groups.length);
  });

  it("keeps the importers in Import, and only they need an extra step", () => {
    const imports = groupTemplates().find((g) => g.id === "import")?.templates ?? [];
    expect(imports.map((t) => t.id).sort()).toEqual(
      ["album_shelf", "letterboxd_match", "letterboxd_watchlist"].sort(),
    );
    const extraStep = LIST_TEMPLATES.filter((t) => t.requiresSource).map((t) => t.id);
    expect(extraStep.every((id) => imports.some((t) => t.id === id))).toBe(true);
  });

  it("drops empty groups", () => {
    const only = [getTemplate("date_ideas")!];
    expect(groupTemplates(only).map((g) => g.id)).toEqual(["plans"]);
  });

  it("names a new list from the template", () => {
    expect(templateListName(getTemplate("movie_watchlist")!)).toBe("Movies to watch");
    expect(templateListName(getTemplate("date_ideas")!)).toBe("Date ideas");
  });
});
