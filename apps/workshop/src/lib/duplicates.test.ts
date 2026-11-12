import type { Item } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import { onListResultIds, splitAgainstList, titleKey } from "./duplicates";

const item = (title: string, content: Record<string, unknown> = {}) =>
  ({ id: title, title, content }) as unknown as Item;

describe("titleKey", () => {
  it("ignores case and spacing", () => {
    expect(titleKey("  Past   Lives ")).toBe(titleKey("past lives"));
  });
});

describe("splitAgainstList", () => {
  it("skips lines already on the list, case-insensitively", () => {
    const res = splitAgainstList(
      ["Hereditary", "past lives", "Aftersun", "Dune"],
      [item("Past Lives"), item("HEREDITARY")],
    );
    expect(res.fresh).toEqual(["Aftersun", "Dune"]);
    expect(res.skipped).toEqual(["Hereditary", "past lives"]);
  });
});
describe("onListResultIds", () => {
  const items = [
    item("Dune", { sourceId: "tmdb-1", year: 2021 }),
    item("Aftersun"),
    item("Solaris", { year: 1972 }),
  ];
  const on = (results: { id: string; title: string; year?: number | null }[]) => [
    ...onListResultIds(results, items),
  ];

  it("matches by source id", () => {
    expect(on([{ id: "tmdb-1", title: "Dune: Part One", year: 2021 }])).toEqual(["tmdb-1"]);
  });
  it("gives a hand-typed title only the first result of that name", () => {
    expect(
      on([
        { id: "a", title: "Aftersun", year: 2022 },
        { id: "b", title: "aftersun", year: 1999 },
      ]),
    ).toEqual(["a"]);
  });
  it("tells remakes apart by year", () => {
    expect(
      on([
        { id: "y", title: "Solaris", year: 2002 },
        { id: "z", title: "Solaris", year: 1972 },
      ]),
    ).toEqual(["z"]);
  });
  it("does not match a different title or a same-titled different source", () => {
    expect(on([{ id: "q", title: "Dune", year: 1984 }])).toEqual([]);
  });
});
