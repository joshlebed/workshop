import { describe, expect, it } from "vitest";
import {
  buildDefaultMetaTags,
  buildDefaultOgImageHtml,
  buildFriendMetaTags,
  buildFriendOgImageHtml,
  buildGameShareMetaTags,
  buildGameShareOgImageHtml,
  buildGameShareThumbnailTitle,
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
    const image = buildGameShareOgImageHtml(
      { sharerName: "Alex" },
      "https://highscore.live/icon-source.png",
    );
    expect(tags).toContain('og:title" content="Play daily games on HighScore"');
    expect(tags).toContain("Alex is playing daily games on HighScore");
    expect(tags).not.toContain("Workshop.dev");
    expect(image).toContain("Play daily games with Alex");
    expect(image).toContain(`width: ${OG_IMAGE_WIDTH}px`);
    expect(image).toContain(`height: ${OG_IMAGE_HEIGHT}px`);
  });

  it("renders the play-link card as app icon + one first-name line, no subtitle", () => {
    const image = buildGameShareOgImageHtml(
      { sharerName: "Josh Lebedinsky" },
      "https://highscore.live/icon-source.png",
    );
    expect(image).toContain('data-brand-icon="highscore"');
    expect(image).not.toContain("🎮");
    expect(image).toContain(">Play daily games with Josh<");
    expect(image).not.toContain("Lebedinsky");
    expect(image).toContain("font-size: 56px");
    // Exactly one text line: the 36px subtitle row is gone.
    expect(image).not.toContain("font-size: 36px");
    expect(image).not.toContain("Join me");

    const anonymous = buildGameShareOgImageHtml(null, "https://highscore.live/icon-source.png");
    expect(anonymous).toContain(">Play daily games on HighScore<");
    expect(anonymous).not.toContain("font-size: 36px");
    expect(buildGameShareThumbnailTitle({ sharerName: "  " })).toBe(
      "Play daily games on HighScore",
    );
    expect(buildGameShareThumbnailTitle({ sharerName: "Bartholomew-Christopherson Q" })).toBe(
      "Play daily games with Bartholomew-Christo…",
    );
  });

  it("rebrands friend-invite tags and artwork", () => {
    const tags = buildFriendMetaTags(
      { inviterName: "Alex" },
      {
        pageUrl: "https://highscore.live/friends/accept/example",
        imageUrl: "https://highscore.live/og/friend/example.png",
      },
    );
    const image = buildFriendOgImageHtml(
      { inviterName: "Alex" },
      "https://highscore.live/icon-source.png",
    );
    expect(tags).toContain("Alex invited you to HighScore");
    expect(tags).not.toContain("Workshop.dev");
    expect(image).toContain("wants to be friends on HighScore");
  });

  it("renders a branded default PNG surface", () => {
    const image = buildDefaultOgImageHtml("https://highscore.live/icon-source.png");
    expect(image).toContain(HIGH_SCORE_OG_TITLE);
    expect(image).toContain(HIGH_SCORE_OG_DESCRIPTION);
    expect(image).toContain('data-brand-icon="highscore"');
    expect(image).toContain('src="https://highscore.live/icon-source.png"');
    // One icon, one wordmark — no duplicated brand row under the subtitle.
    expect(image.match(/data-brand-icon/g)).toHaveLength(1);
    expect(image).not.toContain("<span>HighScore</span>");
    expect(image).not.toContain("data-score-grid");
    expect(image).toContain("#0E0C0B");
    expect(image).not.toContain("linear-gradient");
  });
});
