import { describe, expect, it } from "vitest";
import {
  buildDefaultMetaTags,
  buildLockedListMetaTags,
  buildMetaTags,
  buildMetaTagsRaw,
  buildOgDescription,
  buildOgImageHtml,
  buildOgTitle,
  buildStaticImageHtml,
  buildSummaryLabel,
  buildThumbnailSubtitle,
  COLOR_GRADIENTS,
  DEFAULT_OG_DESCRIPTION,
  DEFAULT_OG_TITLE,
  escapeXml,
  extractListIdFromPath,
  type InvitePreview,
  LOCKED_LIST_OG_SUBTITLE,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  OG_META_SELECTORS,
  truncate,
} from "./og.js";

const samplePreview: InvitePreview = {
  name: "Ski gang games",
  emoji: "🎮",
  color: "ocean",
  description: null,
  itemKind: "link",
  modules: ["leaderboard"],
  itemCount: 5,
  memberCount: 2,
  ownerName: "Preview User",
  shareVisibility: "join",
  shareSlug: "abc12345",
};

describe("escapeXml", () => {
  it("escapes the five XML-significant characters", () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("leaves emoji and non-Latin text alone", () => {
    expect(escapeXml("🎮 résumé")).toBe("🎮 résumé");
  });
});

describe("truncate", () => {
  it("returns input unchanged when under the limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and appends ellipsis at code-point boundary", () => {
    expect(truncate("abcdefg", 5)).toBe("abcd…");
  });

  it("doesn't slice a multi-byte emoji in half", () => {
    // Each emoji is one Unicode code point; truncating mid-byte would
    // produce an invalid character. `Array.from` keeps us safe.
    expect(truncate("🎮🎯🎲🎳🎱", 4)).toBe("🎮🎯🎲…");
  });
});

describe("buildOgTitle", () => {
  it("prefixes the list name with the emoji", () => {
    expect(buildOgTitle(samplePreview)).toBe("🎮 Ski gang games");
  });
});

describe("buildOgDescription", () => {
  it("uses the description when present and trims it", () => {
    expect(buildOgDescription({ ...samplePreview, description: "  Friday night games  " })).toBe(
      "Friday night games",
    );
  });

  it("truncates a long description with an ellipsis", () => {
    const long = "a".repeat(250);
    const out = buildOgDescription({ ...samplePreview, description: long });
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it("falls back to a type/owner/count summary when description is blank", () => {
    expect(buildOgDescription(samplePreview)).toBe(
      "Leaderboard by Preview User · 5 items. Join on Workshop.dev.",
    );
  });

  it("pluralises items correctly", () => {
    expect(buildOgDescription({ ...samplePreview, itemCount: 1 })).toBe(
      "Leaderboard by Preview User · 1 item. Join on Workshop.dev.",
    );
  });

  it("omits the owner clause when ownerName is null", () => {
    expect(buildOgDescription({ ...samplePreview, ownerName: null })).toBe(
      "Leaderboard · 5 items. Join on Workshop.dev.",
    );
  });

  it("never renders 'undefined' for any combination of itemKind + modules", () => {
    // This is the regression test for the live bug we saw: the OG card on
    // `/invite/tlWcI2...` rendered "undefined · 6 items · Josh Lebedinsky"
    // because the API returns `itemKind` + `modules` but the previous
    // helper read a removed `type` field.
    const variants: Array<{ itemKind: InvitePreview["itemKind"]; modules: string[] }> = [
      { itemKind: null, modules: [] },
      { itemKind: "movie", modules: [] },
      { itemKind: "tv", modules: [] },
      { itemKind: "book", modules: [] },
      { itemKind: "link", modules: [] },
      { itemKind: "link", modules: ["leaderboard"] },
      { itemKind: "link", modules: ["leaderboard", "ranking"] },
      { itemKind: "plain", modules: ["todo"] },
      { itemKind: "spotify_album", modules: [] },
    ];
    for (const v of variants) {
      const out = buildOgDescription({ ...samplePreview, description: null, ...v });
      expect(out, `variant ${JSON.stringify(v)}`).not.toContain("undefined");
    }
  });
});

describe("buildThumbnailSubtitle", () => {
  it("renders type + count + owner inside 60 chars", () => {
    const out = buildThumbnailSubtitle(samplePreview);
    expect(out).toBe("Leaderboard · 5 items · Preview User");
    expect(Array.from(out).length).toBeLessThanOrEqual(60);
  });

  it("never renders 'undefined' for any combination of itemKind + modules", () => {
    const variants: Array<{ itemKind: InvitePreview["itemKind"]; modules: string[] }> = [
      { itemKind: null, modules: [] },
      { itemKind: "movie", modules: [] },
      { itemKind: "link", modules: ["leaderboard"] },
      { itemKind: "plain", modules: ["todo"] },
    ];
    for (const v of variants) {
      const out = buildThumbnailSubtitle({ ...samplePreview, ...v });
      expect(out, `variant ${JSON.stringify(v)}`).not.toContain("undefined");
    }
  });
});

describe("buildSummaryLabel", () => {
  it("prefers the leaderboard module over a generic link itemKind (covers the game-list case)", () => {
    expect(buildSummaryLabel({ itemKind: "link", modules: ["leaderboard", "ranking"] })).toBe(
      "Leaderboard",
    );
  });

  it("returns the full kind label for movie/tv/book/spotify_album", () => {
    expect(buildSummaryLabel({ itemKind: "movie", modules: [] })).toBe("Movie list");
    expect(buildSummaryLabel({ itemKind: "tv", modules: [] })).toBe("TV list");
    expect(buildSummaryLabel({ itemKind: "book", modules: [] })).toBe("Reading list");
    expect(buildSummaryLabel({ itemKind: "spotify_album", modules: [] })).toBe("Album shelf");
  });

  it("falls back to module-derived labels when itemKind is generic", () => {
    expect(buildSummaryLabel({ itemKind: null, modules: ["todo"] })).toBe("Checklist");
  });

  it("returns the bare 'List' fallback rather than ever rendering undefined", () => {
    expect(buildSummaryLabel({ itemKind: null, modules: [] })).toBe("List");
    expect(buildSummaryLabel({ itemKind: "plain", modules: [] })).toBe("List");
  });
});

describe("buildMetaTags", () => {
  const tags = buildMetaTags(samplePreview, {
    pageUrl: "https://workshop-a2v.pages.dev/invite/abc",
    imageUrl: "https://workshop-a2v.pages.dev/og/invite/abc",
  });

  // These four tags are the difference between a working FB / iMessage
  // preview and a silent failure. Asserting them by exact substring
  // catches regressions where the URL builder drifts, the dimension
  // numbers stop matching the renderer, or the type meta gets removed
  // (Facebook will refuse to fetch-to-sniff and show nothing).
  it("includes og:image with the absolute URL", () => {
    expect(tags).toContain(
      `<meta property="og:image" content="https://workshop-a2v.pages.dev/og/invite/abc" />`,
    );
  });

  it("includes og:image:secure_url", () => {
    expect(tags).toContain(`<meta property="og:image:secure_url"`);
  });

  it("declares the image as image/png", () => {
    expect(tags).toContain(`<meta property="og:image:type" content="image/png" />`);
  });

  it("declares the dimensions matching the renderer", () => {
    expect(tags).toContain(`<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`);
    expect(tags).toContain(`<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`);
  });

  it("includes summary_large_image twitter card", () => {
    expect(tags).toContain(`<meta name="twitter:card" content="summary_large_image" />`);
  });

  it("escapes XML-unsafe characters in user-provided fields", () => {
    const tagsWithUnsafe = buildMetaTags(
      { ...samplePreview, name: 'Movies <3 "good" ones' },
      { pageUrl: "https://x.test/invite/a", imageUrl: "https://x.test/og/invite/a" },
    );
    expect(tagsWithUnsafe).toContain("&lt;3");
    expect(tagsWithUnsafe).toContain("&quot;good&quot;");
    expect(tagsWithUnsafe).not.toContain(`"good"`);
  });
});

describe("buildOgImageHtml", () => {
  it("uses the gradient stops for the list color", () => {
    const [start, end] = COLOR_GRADIENTS.ocean;
    const html = buildOgImageHtml(samplePreview);
    expect(html).toContain(`linear-gradient(135deg, ${start} 0%, ${end} 100%)`);
  });

  it("falls back to the default static variant when no preview is available", () => {
    const html = buildOgImageHtml(null);
    expect(html).toContain(DEFAULT_OG_TITLE);
    expect(html).toContain(DEFAULT_OG_DESCRIPTION);
  });

  it("sets the exact pixel dimensions the meta tags advertise", () => {
    const html = buildOgImageHtml(samplePreview);
    expect(html).toContain(`width: ${OG_IMAGE_WIDTH}px`);
    expect(html).toContain(`height: ${OG_IMAGE_HEIGHT}px`);
  });

  it("renders the emoji and a truncated title", () => {
    const html = buildOgImageHtml({ ...samplePreview, name: "x".repeat(40) });
    expect(html).toContain("🎮");
    // 28-char cap with ellipsis
    expect(html).toMatch(/x{27}…/);
  });
});

describe("buildMetaTagsRaw", () => {
  const tags = buildMetaTagsRaw({
    title: "Hello",
    description: "World",
    url: "https://example.test/x",
    image: "https://example.test/og/x.png",
  });

  // Smoke-check that every selector the override pipeline removes is
  // actually emitted — otherwise a Pages Function would strip nothing
  // (a meta tag with the wrong attribute order) and re-emit, leaving
  // duplicates that confuse Facebook's first-wins parser.
  it("emits exactly one tag per OG_META_SELECTORS entry", () => {
    for (const selector of OG_META_SELECTORS) {
      const attr = selector.match(/\[(.+?)="(.+?)"\]/);
      expect(attr, `selector parses: ${selector}`).not.toBeNull();
      if (!attr) continue;
      const [, name, value] = attr;
      // Two-step substring match so we don't depend on attribute order.
      const fragment = `${name}="${value}"`;
      expect(tags, `tags contain ${fragment}`).toContain(fragment);
    }
  });

  it("escapes user-provided fields", () => {
    const out = buildMetaTagsRaw({
      title: 'a"b',
      description: "c<d",
      url: "https://x.test",
      image: "https://x.test/og.png",
    });
    expect(out).toContain("a&quot;b");
    expect(out).toContain("c&lt;d");
  });
});

describe("buildDefaultMetaTags", () => {
  const tags = buildDefaultMetaTags({ origin: "https://workshop-a2v.pages.dev" });

  it("uses the brand title and description", () => {
    expect(tags).toContain(`content="${DEFAULT_OG_TITLE}"`);
    expect(tags).toContain(`content="${DEFAULT_OG_DESCRIPTION}"`);
  });

  it("points og:image at /og/default.png on the same origin", () => {
    expect(tags).toContain(
      `<meta property="og:image" content="https://workshop-a2v.pages.dev/og/default.png" />`,
    );
  });
});

describe("buildLockedListMetaTags", () => {
  const tags = buildLockedListMetaTags({
    url: "https://workshop-a2v.pages.dev/list/abc/game/xyz",
    origin: "https://workshop-a2v.pages.dev",
  });

  it("uses the sign-in prompt copy and never leaks list contents", () => {
    expect(tags).toContain(LOCKED_LIST_OG_SUBTITLE);
    // og:url legitimately echoes the recipient's URL (the crawler needs
    // it for card dedupe), but no other tag should leak the list ID —
    // anyone with the URL still has to authenticate to see what's
    // behind it.
    const otherTagText = tags
      .split("\n")
      .filter((line) => !line.includes('property="og:url"'))
      .join("\n");
    expect(otherTagText).not.toContain("abc");
    expect(otherTagText).not.toContain("xyz");
  });

  it("points og:image at /og/locked-list.png", () => {
    expect(tags).toContain(
      `<meta property="og:image" content="https://workshop-a2v.pages.dev/og/locked-list.png" />`,
    );
  });

  it("sets og:url to the recipient's actual URL so the crawler doesn't merge cards across lists", () => {
    expect(tags).toContain(
      `<meta property="og:url" content="https://workshop-a2v.pages.dev/list/abc/game/xyz" />`,
    );
  });
});

describe("extractListIdFromPath", () => {
  const ID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";

  it("pulls the UUID out of /list/:id", () => {
    expect(extractListIdFromPath(`/list/${ID}`)).toBe(ID);
  });

  it("pulls the UUID out of /list/:id/...", () => {
    expect(extractListIdFromPath(`/list/${ID}/settings`)).toBe(ID);
    expect(extractListIdFromPath(`/list/${ID}/game/abc`)).toBe(ID);
  });

  it("returns null for non-UUID segments so the locked-list fallback fires", () => {
    expect(extractListIdFromPath("/list/abc")).toBeNull();
    expect(extractListIdFromPath("/list/abc/game/xyz")).toBeNull();
    expect(extractListIdFromPath("/list/")).toBeNull();
    expect(extractListIdFromPath("/list")).toBeNull();
  });

  it("lowercases the UUID so cache + URL match", () => {
    expect(extractListIdFromPath(`/list/${ID.toUpperCase()}`)).toBe(ID);
  });
});

describe("buildStaticImageHtml", () => {
  it("renders the default Workshop.dev card for the `default` variant", () => {
    const html = buildStaticImageHtml("default");
    expect(html).toContain(DEFAULT_OG_TITLE);
    expect(html).toContain(DEFAULT_OG_DESCRIPTION);
  });

  it("renders the sign-in prompt for the `locked-list` variant", () => {
    const html = buildStaticImageHtml("locked-list");
    expect(html).toContain(LOCKED_LIST_OG_SUBTITLE);
  });

  it("falls back to the default variant for unknown names", () => {
    const html = buildStaticImageHtml("does-not-exist");
    expect(html).toContain(DEFAULT_OG_TITLE);
  });
});
