import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api/formatter", () => ({ previewFormatter: vi.fn(), suggestFormatter: vi.fn() }));

import {
  formatterCardView,
  formatterPreviewAvailable,
  formatterPreviewOffered,
  formatterSuggestAvailable,
} from "./formatterPreview";

const preview = {
  hasFormatter: false,
  samples: [{ periodKey: null, raw: "Krillion #81\n415\n🦑", fallback: "Krillion #81\n415\n🦑" }],
  heuristic: { kind: "heuristic" as const, summaries: ["🦑 415"] },
};
const ready = { isPending: false, data: preview };
const noSuggest = { enabled: false, isPending: false, data: undefined };

describe("formatter preview capabilities", () => {
  it("reads both flags from the cached games list, absent = off", () => {
    const client = new QueryClient();
    expect(formatterPreviewAvailable(client)).toBe(false);
    client.setQueryData(["games", "mine", "2026-11-02"], {
      periodKey: "2026-11-02",
      games: [],
      capabilities: { recognition: true, formatterPreview: true, formatterSuggest: false },
    });
    expect(formatterPreviewAvailable(client)).toBe(true);
    expect(formatterSuggestAvailable(client)).toBe(false);
  });

  it("is offered only for a game known to have no formatter", () => {
    const base = { available: true, token: "t", gameId: "g", text: "x" };
    expect(formatterPreviewOffered({ ...base, hasFormatter: false })).toBe(true);
    expect(formatterPreviewOffered({ ...base, hasFormatter: true })).toBe(false);
    // An old server that does not say: nothing.
    expect(formatterPreviewOffered({ ...base, hasFormatter: undefined })).toBe(false);
    expect(formatterPreviewOffered({ ...base, hasFormatter: false, text: "" })).toBe(false);
  });
});

describe("formatterCardView", () => {
  it("is hidden when not offered, loading while stale or pending", () => {
    expect(
      formatterCardView({ offered: false, stale: false, preview: ready, suggest: noSuggest }),
    ).toEqual({ kind: "hidden" });
    expect(
      formatterCardView({ offered: true, stale: true, preview: ready, suggest: noSuggest }).kind,
    ).toBe("loading");
    expect(
      formatterCardView({
        offered: true,
        stale: false,
        preview: { isPending: true, data: undefined },
        suggest: noSuggest,
      }).kind,
    ).toBe("loading");
  });

  it("offers the heuristic, then the model's option once it arrives", () => {
    const pending = formatterCardView({
      offered: true,
      stale: false,
      preview: ready,
      suggest: { enabled: true, isPending: true, data: undefined },
    });
    expect(pending).toMatchObject({ kind: "ready", suggesting: true });
    expect(pending.kind === "ready" && pending.options.map((o) => o.kind)).toEqual(["heuristic"]);

    const both = formatterCardView({
      offered: true,
      stale: false,
      preview: ready,
      suggest: {
        enabled: true,
        isPending: false,
        data: {
          candidate: { kind: "llm", summaries: ["415"], code: "c", token: "t" },
          reason: null,
        },
      },
    });
    expect(both.kind === "ready" && both.options.map((o) => o.kind)).toEqual(["heuristic", "llm"]);
  });

  it("hides when nothing renders the paste, or the game already has a formatter", () => {
    const blank = { ...preview, heuristic: { kind: "heuristic" as const, summaries: [null] } };
    expect(
      formatterCardView({
        offered: true,
        stale: false,
        preview: { isPending: false, data: blank },
        suggest: noSuggest,
      }),
    ).toEqual({ kind: "hidden" });
    expect(
      formatterCardView({
        offered: true,
        stale: false,
        preview: { isPending: false, data: { ...preview, hasFormatter: true } },
        suggest: noSuggest,
      }),
    ).toEqual({ kind: "hidden" });
  });
});
