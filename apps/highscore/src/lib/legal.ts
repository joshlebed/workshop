// Copy for HighScore's two public pages (`/support`, `/privacy`).
//
// Content lives here rather than inline in the screens so it stays testable:
// `legal.test.ts` pins the claims we make about data handling, and any edit
// that softens or drops one fails the suite. Everything below has to stay
// literally true of the shipped app — these pages are linked from App Store
// Connect, so a stale sentence is a compliance problem, not a typo.

export const SUPPORT_EMAIL = "joshlebed@gmail.com";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("HighScore support")}`;
export const PRIVACY_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("HighScore privacy request")}`;

/** Last time the privacy page's substance changed. Bump on every edit. */
export const PRIVACY_EFFECTIVE_DATE = "August 30, 2026";

export interface LegalSection {
  heading: string;
  body?: string[];
  bullets?: string[];
}

export const SUPPORT_INTRO =
  "HighScore is a small app run by one person. Email is the whole support desk — write any time and you'll get a reply from a human.";

export const SUPPORT_SECTIONS: LegalSection[] = [
  {
    heading: "What we can help with",
    bullets: [
      "Sign-in — trouble continuing with Apple or Google, or getting back into an existing account.",
      "Scores — a result that wouldn't paste, parsed wrong, or landed on the wrong day.",
      "Friends — invites that didn't arrive, requests that won't accept, or someone you want removed.",
      "Feedback — bugs, games you'd like added, and anything that felt worse than it should.",
    ],
  },
  {
    heading: "Getting a faster answer",
    body: [
      "Include the game and date you were looking at, plus the display name on your account. Screenshots help — the paste box and the leaderboard row usually show what went wrong.",
      "The Send feedback button in the profile menu pre-fills the app version and platform for you.",
    ],
  },
  {
    heading: "Account deletion",
    body: [
      "Deleting your account isn't in the app yet. Email the address above and your account, scores, and friend connections will be removed.",
    ],
  },
];

export const PRIVACY_INTRO =
  "HighScore collects what it needs to show your daily games and your friends' scores, and nothing else. This is a plain-language description of how the app actually handles data — it is not legal advice.";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "What HighScore stores",
    bullets: [
      "Account identifiers — your email address, display name, user ID, and an optional profile picture.",
      "Game scores and submissions — the results you post, the game and day they belong to, and the text you pasted to create them.",
      "Friend relationships and invites — who you're connected to, plus pending requests and the invite links you create.",
      "Reactions and share links — the reactions you leave on scores and the short links minted when you share.",
      "Security and session metadata — sign-in and refresh sessions, timestamps, and basic request details kept in server logs.",
    ],
  },
  {
    heading: "How it's used",
    body: [
      "Only to run the app and keep it secure: showing your games, ranking your friends' scores, delivering invites, and detecting abuse or breakage.",
      "There is no other use. Your data isn't mined for profiling or shared to make a product better for someone else.",
    ],
  },
  {
    heading: "Signing in",
    body: [
      "Sign-in is handled by Apple and Google. HighScore never sees or stores a password — it receives an identity token and the email address and name you choose to share, and Apple's Hide My Email works normally.",
    ],
  },
  {
    heading: "What HighScore never does",
    bullets: [
      "No selling or renting your data to anyone.",
      "No third-party advertising or ad networks in the app.",
      "No tracking you across other apps or websites, and no analytics SDKs that do.",
    ],
  },
  {
    heading: "Retention and deletion",
    body: [
      "Your account, scores, and friend connections are kept for as long as your account exists, so your history stays intact between seasons. Sign-in sessions expire on their own — they lapse after long inactivity and always end within a year. Server logs holding request metadata are deleted automatically after one year.",
      "Account deletion isn't yet available inside the app. Send a request through support and your account and its data will be deleted; deletion is permanent and can't be undone.",
    ],
  },
  {
    heading: "Contact",
    body: [
      `Questions, corrections, or a deletion request: email ${SUPPORT_EMAIL} and it will be answered directly.`,
    ],
  },
];
