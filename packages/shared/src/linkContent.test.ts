import { describe, expect, it } from "vitest";
import { linkPreviewToItemContent } from "./linkContent.js";
import type { LinkPreview } from "./types.js";

const basePreview: LinkPreview = {
  url: "https://www.instagram.com/p/example/",
  finalUrl: "https://www.instagram.com/p/example/",
  title: "Example",
  description: "Description",
  image: "https://cdn.example/image.jpg",
  imageProxy: "https://wsrv.nl/?url=https%3A%2F%2Fcdn.example%2Fimage.jpg",
  favicon: "https://www.google.com/s2/favicons?domain=instagram.com&sz=128",
  siteName: "Instagram",
  source: "html",
  fetchedAt: "2026-06-22T13:41:01.878Z",
};

describe("linkPreviewToItemContent", () => {
  it("clamps long text fields to the item content contract", () => {
    const content = linkPreviewToItemContent({
      ...basePreview,
      title: "t".repeat(833),
      description: "d".repeat(2500),
      siteName: "s".repeat(250),
    });

    expect(content.title).toBe("t".repeat(500));
    expect(content.description).toBe("d".repeat(2000));
    expect(content.siteName).toBe("s".repeat(200));
  });

  it("omits overlong URL fields instead of storing broken truncated URLs", () => {
    const longUrl = `https://cdn.example/${"a".repeat(2100)}.jpg`;
    const content = linkPreviewToItemContent({
      ...basePreview,
      finalUrl: longUrl,
      image: longUrl,
      imageProxy: longUrl,
    });

    expect(content.sourceId).toBeUndefined();
    expect(content.image).toBeUndefined();
    expect(content.imageProxy).toBeUndefined();
    expect(content.thumbnailUrl).toBe(basePreview.favicon);
  });
});
