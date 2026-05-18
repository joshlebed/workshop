import { describe, expect, it } from "vitest";
import { __internal, runSiteHandler } from "./site-handlers.js";

describe("isTwitterUrl / isGitHubRepoUrl / isAmazonProductUrl", () => {
  it("recognizes status URLs on twitter.com and x.com", () => {
    expect(__internal.isTwitterUrl(new URL("https://x.com/jack/status/1234567890"))).toBe(true);
    expect(__internal.isTwitterUrl(new URL("https://twitter.com/jack/status/1234567890"))).toBe(
      true,
    );
    expect(__internal.isTwitterUrl(new URL("https://x.com/jack"))).toBe(false);
    expect(__internal.isTwitterUrl(new URL("https://example.com/jack/status/1"))).toBe(false);
  });

  it("recognizes github repo URLs but not system pages", () => {
    expect(__internal.isGitHubRepoUrl(new URL("https://github.com/foo/bar"))).toBe(true);
    expect(__internal.isGitHubRepoUrl(new URL("https://github.com/foo/bar/tree/main"))).toBe(true);
    expect(__internal.isGitHubRepoUrl(new URL("https://github.com/marketplace/x"))).toBe(false);
    expect(__internal.isGitHubRepoUrl(new URL("https://github.com/settings"))).toBe(false);
  });

  it("recognizes amazon /dp/<asin> URLs across regional TLDs", () => {
    expect(__internal.isAmazonProductUrl(new URL("https://www.amazon.com/dp/B0CHX3QBCH"))).toBe(
      true,
    );
    expect(
      __internal.isAmazonProductUrl(new URL("https://amazon.co.uk/gp/product/B0CHX3QBCH")),
    ).toBe(true);
    expect(__internal.isAmazonProductUrl(new URL("https://amazon.com/"))).toBe(false);
  });
});

describe("fxTwitter", () => {
  it("returns the first photo URL + author/text from a FxTwitter response", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          code: 200,
          status: {
            id: "1",
            text: "Hello world",
            author: { name: "Jack Dorsey", screen_name: "jack" },
            media: {
              photos: [{ type: "photo", url: "https://pbs.x/photo-1.jpg" }],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const r = await __internal.fxTwitter(
      new URL("https://x.com/jack/status/1234567890"),
      fakeFetch,
    );
    expect(r).toMatchObject({
      image: "https://pbs.x/photo-1.jpg",
      title: "Jack Dorsey on X",
      handler: "fxtwitter",
    });
    expect(r?.description).toBe("Hello world");
  });

  it("falls back to a video thumbnail when no photos are present", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          code: 200,
          status: {
            id: "1",
            text: null,
            author: { screen_name: "jack" },
            media: {
              videos: [{ thumbnail_url: "https://pbs.x/video-thumb.jpg" }],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const r = await __internal.fxTwitter(
      new URL("https://x.com/jack/status/1234567890"),
      fakeFetch,
    );
    expect(r?.image).toBe("https://pbs.x/video-thumb.jpg");
  });

  it("returns null for non-status URLs", async () => {
    const fakeFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const r = await __internal.fxTwitter(new URL("https://x.com/jack"), fakeFetch);
    expect(r).toBeNull();
  });
});

describe("githubRepo", () => {
  it("returns the opengraph.githubassets.com URL for a repo", async () => {
    const fakeFetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const r = await __internal.githubRepo(new URL("https://github.com/foo/bar"), fakeFetch);
    expect(r?.image).toBe("https://opengraph.githubassets.com/1/foo/bar");
    expect(r?.title).toBe("foo/bar");
  });

  it("strips .git from the repo segment", async () => {
    const fakeFetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const r = await __internal.githubRepo(new URL("https://github.com/foo/bar.git"), fakeFetch);
    expect(r?.image).toBe("https://opengraph.githubassets.com/1/foo/bar");
  });
});

describe("amazonProduct", () => {
  it("extracts the ASIN and returns the canonical product image URL", async () => {
    const fakeFetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const r = await __internal.amazonProduct(
      new URL("https://www.amazon.com/dp/B0CHX3QBCH/"),
      fakeFetch,
    );
    expect(r?.image).toBe(
      "https://images-na.ssl-images-amazon.com/images/P/B0CHX3QBCH.01.LZZZZZZZ.jpg",
    );
  });
});

describe("runSiteHandler", () => {
  it("returns null when no handler matches", async () => {
    const fakeFetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    expect(await runSiteHandler(new URL("https://example.com/post"), fakeFetch)).toBeNull();
  });

  it("dispatches to the first matching handler", async () => {
    const fakeFetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const r = await runSiteHandler(new URL("https://github.com/foo/bar"), fakeFetch);
    expect(r?.handler).toBe("github-repo");
  });
});
