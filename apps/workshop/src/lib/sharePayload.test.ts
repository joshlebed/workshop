import type { LinkPreview } from "@workshop/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workshop/api-client/storage", () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

const {
  canQuickSave,
  normalizeSharePayload,
  noteFromSharedText,
  parsePendingShare,
  PENDING_SHARE_TTL_MS,
  shareAddParams,
  shareCaption,
  sharedItemRequest,
  sharePayloadParams,
  sharePickOrder,
  titleFromSharedText,
} = await import("./sharePayload");

const preview = (over: Partial<LinkPreview> = {}): LinkPreview =>
  ({
    url: "https://example.com/a",
    finalUrl: "https://example.com/a",
    title: "A great place",
    description: "Tacos",
    image: null,
    imageProxy: null,
    favicon: null,
    siteName: "Example",
    source: "html",
    ...over,
  }) as LinkPreview;

describe("normalizeSharePayload", () => {
  it("keeps both a URL and its text (4.4)", () => {
    expect(normalizeSharePayload({ url: "https://example.com/a", text: "Dinner Friday?" })).toEqual(
      { url: "https://example.com/a", text: "Dinner Friday?" },
    );
  });

  it("drops text that only repeats the URL (expo-share-intent mirrors it)", () => {
    expect(
      normalizeSharePayload({ url: "https://example.com/a", text: "https://example.com/a" }),
    ).toEqual({ url: "https://example.com/a", text: null });
  });

  it("finds the link inside a text share and keeps the words", () => {
    expect(normalizeSharePayload({ text: "Look at this https://example.com/a so good" })).toEqual({
      url: "https://example.com/a",
      text: "Look at this so good",
    });
  });

  it("treats a 'url' that isn't one as text, and empty as nothing", () => {
    expect(normalizeSharePayload({ url: "just words" })).toEqual({
      url: null,
      text: "just words",
    });
    expect(normalizeSharePayload({ url: " ", text: "" })).toBeNull();
    expect(normalizeSharePayload({ url: "javascript:alert(1)" })).toEqual({
      url: null,
      text: "javascript:alert(1)",
    });
  });
});

describe("carrying a share through the flow", () => {
  const p = { url: "https://example.com/a", text: "Dinner Friday?" };
  it("rides as url/text to the picker and New list", () => {
    expect(sharePayloadParams(p)).toEqual({ url: p.url, text: p.text });
    expect(sharePayloadParams({ url: null, text: "hi" })).toEqual({ text: "hi" });
  });

  it("arrives on the add surface as both prefills, in share mode", () => {
    expect(shareAddParams(p)).toEqual({
      prefillUrl: p.url,
      prefillText: p.text,
      from: "share",
    });
  });

  it("captions the picker", () => {
    expect(shareCaption({ url: "https://www.nytimes.com/x", text: null })).toBe(
      "Saving from nytimes.com",
    );
    expect(shareCaption({ url: null, text: "x" })).toBe("Saving shared text");
  });
});

describe("shared text → title and note", () => {
  it("titles from the first line; a long text keeps itself as the note", () => {
    expect(titleFromSharedText("\n  Pasta night \nwith Sam")).toBe("Pasta night");
    expect(noteFromSharedText("one line", false)).toBe("");
    expect(noteFromSharedText("first\nsecond", false)).toBe("first\nsecond");
    expect(noteFromSharedText("one line", true)).toBe("one line");
  });
});

describe("sharedItemRequest", () => {
  it("makes a link item with preview content and keeps the shared words as the note", () => {
    const req = sharedItemRequest(
      { url: "https://example.com/a", text: "Dinner Friday?" },
      "link",
      preview(),
    );
    expect(req.kind).toBe("link");
    expect(req.title).toBe("A great place");
    expect(req.url).toBe("https://example.com/a");
    expect(req.note).toBe("Dinner Friday?");
    expect(req.content).toBeDefined();
  });

  it("clamps a huge social title through linkPreviewToItemContent", () => {
    const req = sharedItemRequest(
      { url: "https://example.com/a", text: null },
      "link",
      preview({ title: "x".repeat(900) }),
    );
    expect(req.title.length).toBeLessThanOrEqual(500);
  });

  it("names it from the text, then the host, when there is no preview", () => {
    expect(
      sharedItemRequest({ url: "https://www.example.com/a", text: "Tacos" }, "link", null).title,
    ).toBe("Tacos");
    expect(
      sharedItemRequest({ url: "https://www.example.com/a", text: null }, "link", null).title,
    ).toBe("example.com");
  });

  it("keeps a plain item's content empty even with a link", () => {
    const req = sharedItemRequest({ url: "https://example.com/a", text: null }, "plain", preview());
    expect(req.kind).toBe("plain");
    expect(req.url).toBe("https://example.com/a");
    expect(req.content).toBeUndefined();
  });

  it("uses the list's free kind: link for a URL, plain for text", () => {
    expect(sharedItemRequest({ url: "https://e.com", text: null }, null, null).kind).toBe("link");
    expect(sharedItemRequest({ url: null, text: "Milk" }, null, null)).toEqual({
      kind: "plain",
      title: "Milk",
    });
  });

  it("only quick-saves into lists that take a free line", () => {
    expect(canQuickSave(null)).toBe(true);
    expect(canQuickSave("link")).toBe(true);
    expect(canQuickSave("plain")).toBe(true);
    expect(canQuickSave("movie")).toBe(false);
    expect(canQuickSave("spotify_album")).toBe(false);
  });
});

describe("sharePickOrder", () => {
  const lists = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("floats the last-used list to the top and keeps the rest in order", () => {
    expect(sharePickOrder(lists, "c").map((l) => l.id)).toEqual(["c", "a", "b"]);
  });
  it("leaves the order alone when the last list is gone or unknown", () => {
    expect(sharePickOrder(lists, "zz").map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(sharePickOrder(lists, null).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("parsePendingShare (signed-out stash)", () => {
  const now = 1_800_000_000_000;
  it("resumes a fresh stash", () => {
    const raw = JSON.stringify({ url: "https://e.com/x", text: "hi", at: now - 1000 });
    expect(parsePendingShare(raw, now)).toEqual({ url: "https://e.com/x", text: "hi" });
  });
  it("drops a stale, malformed or empty stash", () => {
    expect(
      parsePendingShare(
        JSON.stringify({ url: "https://e.com", at: now - PENDING_SHARE_TTL_MS - 1 }),
        now,
      ),
    ).toBeNull();
    expect(parsePendingShare("{not json", now)).toBeNull();
    expect(parsePendingShare(JSON.stringify({ url: "https://e.com" }), now)).toBeNull();
    expect(parsePendingShare(JSON.stringify({ text: "", at: now }), now)).toBeNull();
    expect(parsePendingShare(null, now)).toBeNull();
  });
});
