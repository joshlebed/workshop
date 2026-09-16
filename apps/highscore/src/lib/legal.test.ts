import { describe, expect, it } from "vitest";
import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_INTRO,
  PRIVACY_MAILTO,
  PRIVACY_SECTIONS,
  SUPPORT_EMAIL,
  SUPPORT_INTRO,
  SUPPORT_MAILTO,
  SUPPORT_SECTIONS,
  TERMS_EFFECTIVE_DATE,
  TERMS_INTRO,
  TERMS_SECTIONS,
} from "./legal";

const flatten = (sections: typeof PRIVACY_SECTIONS) =>
  sections
    .flatMap((section) => [section.heading, ...(section.body ?? []), ...(section.bullets ?? [])])
    .join("\n")
    .toLowerCase();

const supportText = `${SUPPORT_INTRO}\n${flatten(SUPPORT_SECTIONS)}`.toLowerCase();
const privacyText = `${PRIVACY_INTRO}\n${flatten(PRIVACY_SECTIONS)}`.toLowerCase();
const termsText = `${TERMS_INTRO}\n${flatten(TERMS_SECTIONS)}`.toLowerCase();

describe("support page copy", () => {
  it("points at the address feedback already goes to", () => {
    expect(SUPPORT_EMAIL).toBe("joshlebed@gmail.com");
    expect(SUPPORT_MAILTO.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
    expect(PRIVACY_MAILTO.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
  });

  it("covers the four things support actually handles", () => {
    for (const topic of ["sign-in", "scores", "friends", "feedback"]) {
      expect(supportText).toContain(topic);
    }
  });

  it("sends account deletion to the in-app control, not to email", () => {
    expect(supportText).toContain("danger zone → delete account");
    expect(supportText).not.toMatch(/deleting your account isn't in the app/i);
  });
});

describe("privacy page copy", () => {
  it("carries an effective date and a contact route", () => {
    expect(PRIVACY_EFFECTIVE_DATE).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    expect(privacyText).toContain(SUPPORT_EMAIL);
  });

  it("names every category of data HighScore stores", () => {
    for (const category of [
      "email",
      "display name",
      "user id",
      "profile picture",
      "scores",
      "friend",
      "invite",
      "reactions",
      "share links",
      "session",
    ]) {
      expect(privacyText).toContain(category);
    }
  });

  it("states the authentication providers and the limits on use", () => {
    expect(privacyText).toContain("apple");
    expect(privacyText).toContain("google");
    expect(privacyText).toContain("secure");
    expect(privacyText).toContain("no selling");
    expect(privacyText).toContain("advertising");
    expect(privacyText).toContain("tracking you across other apps or websites");
  });

  it("describes retention and the in-app deletion path", () => {
    expect(privacyText).toContain("retention");
    expect(privacyText).toContain("deleted automatically after one year");
    // Deletion shipped: the copy must point at the in-app control, name the
    // shared Workshop.dev impact, and never send anyone to email for it.
    expect(privacyText).toContain("danger zone → delete account");
    expect(privacyText).toContain("workshop.dev");
    expect(privacyText).toContain("permanent");
    expect(privacyText).not.toMatch(/deletion isn't yet available/i);
    expect(privacyText).not.toMatch(/send a request through support/i);
  });

  it("describes provider token handling on deletion honestly", () => {
    // Apple revocation is implemented; Google has nothing to revoke because we
    // never request offline access. Neither claim may drift from the backend.
    expect(privacyText).toContain("revoke");
    expect(privacyText).toContain("never requests ongoing access");
  });

  it("does not pass itself off as legal advice", () => {
    expect(PRIVACY_INTRO.toLowerCase()).toContain("not legal advice");
  });
});

describe("terms page copy (App Store Review Guideline 1.2)", () => {
  it("carries an effective date", () => {
    expect(TERMS_EFFECTIVE_DATE).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  it("states zero tolerance for objectionable content and abusive users", () => {
    expect(termsText).toContain("no tolerance for objectionable content");
    expect(termsText).toContain("zero tolerance");
    expect(termsText).toContain("abus");
  });

  it("describes the report, block, filter and 24-hour commitments the app ships", () => {
    for (const phrase of ["report", "block", "filter", "within 24 hours", "ejected"]) {
      expect(termsText).toContain(phrase);
    }
  });
});

describe("privacy page — score upload consent (Guideline 5.1.2)", () => {
  it("says scores are uploaded and shown to friends, and never globally", () => {
    expect(privacyText).toContain("uploads it to highscore's server");
    expect(privacyText).toContain("no public or global leaderboard");
    expect(privacyText).toContain("blocks and reports");
  });
});
