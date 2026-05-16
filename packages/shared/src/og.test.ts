import { describe, expect, it } from "vitest";
import {
  buildMetaTags,
  buildOgDescription,
  buildOgImageHtml,
  buildOgTitle,
  buildThumbnailSubtitle,
  COLOR_GRADIENTS,
  escapeXml,
  type InvitePreview,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  truncate,
} from "./og.js";

const samplePreview: InvitePreview = {
  name: "Ski gang games",
  emoji: "🎮",
  color: "ocean",
  description: null,
  type: "game",
  itemCount: 5,
  memberCount: 2,
  ownerName: "Preview User",
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
      "Game leaderboard by Preview User · 5 items. Join on Workshop.dev.",
    );
  });

  it("pluralises items correctly", () => {
    expect(buildOgDescription({ ...samplePreview, itemCount: 1 })).toBe(
      "Game leaderboard by Preview User · 1 item. Join on Workshop.dev.",
    );
  });

  it("omits the owner clause when ownerName is null", () => {
    expect(buildOgDescription({ ...samplePreview, ownerName: null })).toBe(
      "Game leaderboard · 5 items. Join on Workshop.dev.",
    );
  });
});

describe("buildThumbnailSubtitle", () => {
  it("renders type + count + owner inside 60 chars", () => {
    const out = buildThumbnailSubtitle(samplePreview);
    expect(out).toBe("Game leaderboard · 5 items · Preview User");
    expect(Array.from(out).length).toBeLessThanOrEqual(60);
  });
});

describe("buildMetaTags", () => {
  const tags = buildMetaTags(samplePreview, {
    inviteUrl: "https://workshop-a2v.pages.dev/invite/abc",
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
      { inviteUrl: "https://x.test/invite/a", imageUrl: "https://x.test/og/invite/a" },
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

  it("falls back to slate when no preview is available", () => {
    const [start] = COLOR_GRADIENTS.slate;
    const html = buildOgImageHtml(null);
    expect(html).toContain(start);
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
