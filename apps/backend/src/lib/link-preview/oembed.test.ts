import { describe, expect, it } from "vitest";
import {
  discoverOembedEndpoint,
  fetchOembed,
  fetchOembedDiscovered,
  lookupProviderEndpoint,
} from "./oembed.js";

// Bypass the DNS-based SSRF guard for unit tests — the synthetic hostnames
// below ("wp.example", "target.example") don't resolve and would otherwise
// short-circuit the fetch.
const allowAnyHost = async (): Promise<void> => undefined;

describe("lookupProviderEndpoint", () => {
  it("matches YouTube hosts", () => {
    expect(lookupProviderEndpoint(new URL("https://www.youtube.com/watch?v=abc"))).toBe(
      "https://www.youtube.com/oembed",
    );
    expect(lookupProviderEndpoint(new URL("https://youtu.be/abc"))).toBe(
      "https://www.youtube.com/oembed",
    );
    expect(lookupProviderEndpoint(new URL("https://m.youtube.com/watch?v=abc"))).toBe(
      "https://www.youtube.com/oembed",
    );
  });

  it("matches Vimeo / Spotify / Reddit / Bandcamp / TikTok / SoundCloud", () => {
    expect(lookupProviderEndpoint(new URL("https://vimeo.com/123"))).toBe(
      "https://vimeo.com/api/oembed.json",
    );
    expect(lookupProviderEndpoint(new URL("https://open.spotify.com/album/abc"))).toBe(
      "https://open.spotify.com/oembed",
    );
    expect(lookupProviderEndpoint(new URL("https://www.reddit.com/r/x/comments/y/z"))).toBe(
      "https://www.reddit.com/oembed",
    );
    expect(lookupProviderEndpoint(new URL("https://artist.bandcamp.com/track/abc"))).toBe(
      "https://bandcamp.com/oembed",
    );
    expect(lookupProviderEndpoint(new URL("https://www.tiktok.com/@user/video/1"))).toBe(
      "https://www.tiktok.com/oembed",
    );
    expect(lookupProviderEndpoint(new URL("https://soundcloud.com/user/track"))).toBe(
      "https://soundcloud.com/oembed",
    );
  });

  it("returns null for hosts not in the registry", () => {
    expect(lookupProviderEndpoint(new URL("https://example.com/x"))).toBeNull();
  });
});

describe("discoverOembedEndpoint", () => {
  it("finds the application/json+oembed alternate link", () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/json+oembed" href="https://wp.example/wp-json/oembed/1.0/embed?url=foo">
      </head></html>`;
    expect(discoverOembedEndpoint(html)).toBe(
      "https://wp.example/wp-json/oembed/1.0/embed?url=foo",
    );
  });

  it("ignores xml+oembed alternates", () => {
    const html = `
      <head>
        <link rel="alternate" type="text/xml+oembed" href="https://wp.example/oembed?format=xml">
      </head>`;
    expect(discoverOembedEndpoint(html)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(discoverOembedEndpoint("<head></head>")).toBeNull();
  });
});

describe("fetchOembed / fetchOembedDiscovered", () => {
  it("appends ?url= and format=json to the endpoint and parses the response", async () => {
    const received: string[] = [];
    const fakeFetch = (async (input: string) => {
      received.push(input);
      return new Response(
        JSON.stringify({
          type: "video",
          title: "Cool",
          thumbnail_url: "https://cdn.example/t.jpg",
          thumbnail_width: 480,
          thumbnail_height: 360,
          provider_name: "TestProvider",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await fetchOembedDiscovered(
      "https://wp.example/oembed",
      new URL("https://target.example/x"),
      fakeFetch,
      allowAnyHost,
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toContain("url=https%3A%2F%2Ftarget.example%2Fx");
    expect(received[0]).toContain("format=json");
    expect(result).toMatchObject({
      thumbnailUrl: "https://cdn.example/t.jpg",
      thumbnailWidth: 480,
      thumbnailHeight: 360,
      title: "Cool",
      providerName: "TestProvider",
    });
  });

  it("returns null on HTTP error", async () => {
    const fakeFetch = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const r = await fetchOembed(
      new URL("https://www.youtube.com/watch?v=1"),
      fakeFetch,
      allowAnyHost,
    );
    expect(r).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const fakeFetch = (async () =>
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const r = await fetchOembed(
      new URL("https://www.youtube.com/watch?v=1"),
      fakeFetch,
      allowAnyHost,
    );
    expect(r).toBeNull();
  });

  it("returns null for non-registry URLs", async () => {
    const fakeFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const r = await fetchOembed(new URL("https://example.com/post"), fakeFetch, allowAnyHost);
    expect(r).toBeNull();
  });
});
