import { describe, expect, it } from "vitest";
import {
  buildDefaultMetaTags,
  buildDefaultOgImageHtml,
  buildFriendMetaTags,
  buildFriendOgImageHtml,
  buildGameShareMetaTags,
  buildGameShareOgImageHtml,
  buildMetaTagsRaw,
  HIGH_SCORE_OG_DESCRIPTION,
  HIGH_SCORE_OG_TITLE,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  OG_META_SELECTORS,
} from "../../functions/_lib/og.js";

describe("HighScore Open Graph helpers", () => {
  it("keeps the default tags on the HighScore origin", () => {
    const tags = buildDefaultMetaTags("https://highscore.live");
    expect(tags).toContain(`content="${HIGH_SCORE_OG_TITLE}"`);
    expect(tags).toContain(`content="${HIGH_SCORE_OG_DESCRIPTION}"`);
    expect(tags).toContain('content="https://highscore.live/og/default.png"');
  });

  it("emits exactly one tag for every selector removed by route overrides", () => {
    const tags = buildMetaTagsRaw({
      title: "HighScore",
      description: "Daily games",
      url: "https://highscore.live/g/example",
      image: "https://highscore.live/og/g/example.png",
    });

    for (const selector of OG_META_SELECTORS) {
      const attribute = selector.match(/\[(.+?)="(.+?)"\]/);
      expect(attribute, `selector parses: ${selector}`).not.toBeNull();
      if (!attribute) continue;
      const [, name, value] = attribute;
      const matches = tags.match(new RegExp(`${name}="${value}"`, "g"));
      expect(matches, selector).toHaveLength(1);
    }
  });

  it("rebrands game-share tags and artwork", () => {
    const tags = buildGameShareMetaTags(
      { sharerName: "Alex" },
      {
        pageUrl: "https://highscore.live/g/example",
        imageUrl: "https://highscore.live/og/g/example.png",
      },
    );
    const image = buildGameShareOgImageHtml({ sharerName: "Alex" });
    expect(tags).toContain("Play games with Alex on HighScore");
    expect(tags).not.toContain("Workshop.dev");
    expect(image).toContain("Join me and play games on HighScore");
    expect(image).toContain(`width: ${OG_IMAGE_WIDTH}px`);
    expect(image).toContain(`height: ${OG_IMAGE_HEIGHT}px`);
  });

  it("rebrands friend-invite tags and artwork", () => {
    const tags = buildFriendMetaTags(
      { inviterName: "Alex" },
      {
        pageUrl: "https://highscore.live/friends/accept/example",
        imageUrl: "https://highscore.live/og/friend/example.png",
      },
    );
    const image = buildFriendOgImageHtml({ inviterName: "Alex" });
    expect(tags).toContain("Alex invited you to HighScore");
    expect(tags).not.toContain("Workshop.dev");
    expect(image).toContain("wants to be friends on HighScore");
  });

  it("renders a branded default PNG surface", () => {
    const image = buildDefaultOgImageHtml();
    expect(image).toContain(HIGH_SCORE_OG_TITLE);
    expect(image).toContain(HIGH_SCORE_OG_DESCRIPTION);
    expect(image).toContain('data-score-grid="highscore"');
    expect(image).toContain("#F5A524");
    expect(image).toContain("#3C3835");
    expect(image).toContain("#0E0C0B");
    expect(image).not.toContain("linear-gradient");
  });
});
