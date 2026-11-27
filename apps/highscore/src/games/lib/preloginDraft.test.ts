import { describe, expect, it } from "vitest";
import {
  buildDraft,
  draftDisposition,
  INVITE_CONTEXT_MAX_AGE_MS,
  invitePath,
  newDraftId,
  type PreloginInviteContext,
  type PreloginScoreDraft,
  parseStoredDraft,
  parseStoredInviteContext,
  readDraftText,
  sharerPlayedGame,
  signInContextCopy,
} from "./preloginDraft";

const MAPTAP = "www.maptap.gg May 18\n96🔥 95🏅 99🎯 96🔥 93👑\nFinal score: 937";

function draft(overrides: Partial<PreloginScoreDraft> = {}): PreloginScoreDraft {
  return {
    v: 1,
    id: "d_abc",
    linkKind: "play",
    linkToken: "Tok12345",
    gameKey: "maptap",
    gameTitle: "MapTap",
    canonicalUrl: "https://maptap.gg",
    scoreRaw: MAPTAP,
    periodKey: "2026-11-25",
    createdAt: 1_000,
    sharerPlayed: true,
    ...overrides,
  };
}

const context: PreloginInviteContext = {
  v: 1,
  linkKind: "play",
  linkToken: "Tok12345",
  inviterName: "Josh",
  inviterId: "u1",
  savedAt: 1_000,
};

describe("readDraftText", () => {
  it("is empty for blank text", () => {
    expect(readDraftText("  ")).toEqual({ kind: "empty" });
    expect(readDraftText(null)).toEqual({ kind: "empty" });
  });

  it("reads a known game's share locally — game, score, summary", () => {
    const reading = readDraftText(MAPTAP);
    expect(reading).toMatchObject({
      kind: "recognized",
      gameKey: "maptap",
      gameTitle: "MapTap",
      canonicalUrl: "https://maptap.gg",
      scoreDisplay: "937",
    });
    expect(reading.kind === "recognized" && reading.summary).toContain("Final score: 937");
  });

  it("flags a bare game link as resultless, naming the game", () => {
    expect(readDraftText("https://dailytens.com/?ref=944415")).toEqual({
      kind: "resultless",
      gameTitle: "Daily Tens",
    });
  });

  it("says unrecognized for text no game's pattern matches", () => {
    expect(readDraftText("I scored 42 on something")).toEqual({ kind: "unrecognized" });
  });
});

describe("buildDraft", () => {
  const base = {
    id: "d_abc",
    linkKind: "play" as const,
    linkToken: "Tok12345",
    periodKey: "2026-11-25",
    now: 1_000,
  };

  it("builds a draft for a recognised reading and notes whether the sharer played it", () => {
    const built = buildDraft({
      ...base,
      text: `  ${MAPTAP}  `,
      reading: readDraftText(MAPTAP),
      sharerGames: ["Daily Tens", "maptap"],
    });
    expect(built).toEqual(draft());
  });

  it("keeps nothing for an unrecognised or resultless paste", () => {
    expect(buildDraft({ ...base, text: "hello", reading: readDraftText("hello") })).toBeNull();
    const link = "https://dailytens.com/?ref=1";
    expect(buildDraft({ ...base, text: link, reading: readDraftText(link) })).toBeNull();
  });

  it("caps the stored text and omits sharerPlayed on a friend invite", () => {
    const long = `${MAPTAP}\n${"x".repeat(2000)}`;
    const built = buildDraft({
      ...base,
      linkKind: "friend",
      text: long,
      reading: readDraftText(long),
    });
    expect(built?.scoreRaw.length).toBe(1000);
    expect(built && "sharerPlayed" in built).toBe(false);
  });
});

describe("stored values", () => {
  it("round-trips a draft and rejects anything malformed", () => {
    expect(parseStoredDraft(JSON.stringify(draft()))).toEqual(draft());
    expect(parseStoredDraft("{not json")).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ ...draft(), periodKey: "today" }))).toBeNull();
    expect(parseStoredDraft(null)).toBeNull();
  });

  it("ignores an invite context older than a day", () => {
    const raw = JSON.stringify(context);
    expect(parseStoredInviteContext(raw, 2_000)).toEqual(context);
    expect(parseStoredInviteContext(raw, 1_001 + INVITE_CONTEXT_MAX_AGE_MS)).toBeNull();
  });
});

describe("draftDisposition", () => {
  it("uses this link's draft for today", () => {
    expect(draftDisposition(draft(), "play", "Tok12345", "2026-11-25")).toBe("use");
  });
  it("expires a draft from another day, even for this link", () => {
    expect(draftDisposition(draft(), "play", "Tok12345", "2026-11-26")).toBe("expired");
  });
  it("leaves another link's draft alone", () => {
    expect(draftDisposition(draft(), "friend", "Tok12345", "2026-11-25")).toBe("other-link");
    expect(draftDisposition(draft(), "play", "Other123", "2026-11-25")).toBe("other-link");
  });
  it("is none without a draft", () => {
    expect(draftDisposition(null, "play", "Tok12345", "2026-11-25")).toBe("none");
  });
});

describe("signInContextCopy", () => {
  it("names the inviter and the pasted game", () => {
    expect(signInContextCopy(context, draft())).toEqual({
      title: "Josh invited you",
      caption: "Sign in to save your MapTap score.",
    });
  });
  it("falls back to the link's purpose without a matching draft", () => {
    expect(signInContextCopy(context, draft({ linkToken: "Other123" })).caption).toBe(
      "Sign in to compare scores with Josh.",
    );
    expect(signInContextCopy({ ...context, linkKind: "friend", inviterName: null }, null)).toEqual({
      title: "A friend invited you",
      caption: "Sign in to add them as a friend.",
    });
  });
});

describe("helpers", () => {
  it("matches sharer titles case-insensitively", () => {
    expect(sharerPlayedGame("MapTap", [" maptap "])).toBe(true);
    expect(sharerPlayedGame("MapTap", ["Daily Tens"])).toBe(false);
  });
  it("builds the path back to the invite", () => {
    expect(invitePath("play", "a b")).toBe("/g/a%20b");
    expect(invitePath("friend", "Tok")).toBe("/friends/accept/Tok");
  });
  it("makes a prefixed draft id", () => {
    expect(newDraftId(() => 0)).toBe("d_000000000000");
    expect(newDraftId()).toMatch(/^d_[0-9a-z]{12}$/);
  });
});
