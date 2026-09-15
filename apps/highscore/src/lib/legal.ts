// Copy for HighScore's three public pages (`/support`, `/privacy`, `/terms`).
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
export const PRIVACY_EFFECTIVE_DATE = "September 15, 2026";

/** Last time the terms page's substance changed. Bump on every edit. */
export const TERMS_EFFECTIVE_DATE = "September 15, 2026";

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
      "Reports — anything you've flagged with Report or Block in the app, or a name, photo or score you think shouldn't be there.",
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
      "Delete your account from inside the app: profile menu → Edit profile → Danger zone → Delete account. It takes effect immediately and can't be undone.",
      "HighScore and Workshop.dev share one account, so deleting here also deletes your Workshop.dev lists, items, and activity. The confirmation screen spells this out before you commit.",
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
      "Game scores and submissions — the results you post, the game and day they belong to, and the text you pasted to create them. Posting a score uploads it to HighScore's server and shows it, with your name and photo, to the friends you've added — that's the whole point of the leaderboard, and the sign-in screen says so before you start.",
      "Friend relationships and invites — who you're connected to, plus pending requests and the invite links you create.",
      "Reactions and share links — the reactions you leave on scores and the short links minted when you share.",
      "Blocks and reports — who you've blocked, and any content reports you send (including a snapshot of what was reported) so a person can review them.",
      "Security and session metadata — sign-in and refresh sessions, timestamps, and basic request details kept in server logs.",
    ],
  },
  {
    heading: "How it's used",
    body: [
      "Only to run the app and keep it secure: showing your games, ranking your friends' scores, delivering invites, reviewing reports, and detecting abuse or breakage.",
      "Your scores are visible only to you and the friends you've added — there is no public or global leaderboard. Removing or blocking a friend stops them seeing your scores immediately.",
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
      "You can delete your account at any time from the app: profile menu → Edit profile → Danger zone → Delete account. Deletion is immediate and permanent — your profile, scores, reactions, friend connections, invites, blocks and share links are removed, not deactivated, and it can't be undone.",
      "Because HighScore and Workshop.dev are one account, deleting also removes your Workshop.dev lists, items, and activity, including shared lists you own. Other people's own lists and scores are untouched.",
      "If you signed in with Apple, HighScore also asks Apple to revoke the sign-in tokens it holds for you. Google sign-in leaves nothing to revoke — HighScore only ever verifies an identity token and never requests ongoing access to your Google account.",
    ],
  },
  {
    heading: "Contact",
    body: [
      `Questions or corrections: email ${SUPPORT_EMAIL} and it will be answered directly. Account deletion doesn't need an email — it's in the app.`,
    ],
  },
];

export const TERMS_INTRO =
  "HighScore is a place to compare daily-game scores with friends. These are the rules for using it — short, plain, and enforced. Signing in means you agree to them.";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "No tolerance for objectionable content or abusive users",
    body: [
      "Your display name, profile photo and the results you post are seen by other people. There is zero tolerance for hateful, harassing, threatening, sexually explicit or otherwise objectionable content, and zero tolerance for users who abuse others.",
      "HighScore filters names and score posts for slurs and abusive language at the moment they're saved, and rejects ones that don't pass. Anything the filter misses can be reported.",
    ],
  },
  {
    heading: "Reporting and blocking",
    bullets: [
      "Report — every profile and every score post has a Report action. Reports go straight to the person who runs HighScore and are acted on within 24 hours: offending content is removed and the account responsible is ejected.",
      "Block — any profile has a Block action. Blocking removes that person as a friend, hides you from each other's leaderboards immediately, stops any friend request between you, and notifies HighScore. You can unblock from Edit profile.",
    ],
  },
  {
    heading: "Your account",
    bullets: [
      "You must be at least 13 years old to use HighScore.",
      "You're responsible for what's posted from your account. Keep it to your own results.",
      "HighScore and Workshop.dev share one account; deleting it from either app deletes both. You can delete it at any time from Edit profile → Danger zone.",
      "HighScore may remove content or close an account that breaks these terms, without notice.",
    ],
  },
  {
    heading: "The games",
    body: [
      "The daily games you paste results from belong to their own publishers. HighScore only records the share text you paste and is not affiliated with any of them.",
    ],
  },
  {
    heading: "No warranty",
    body: [
      "HighScore is provided as-is by one person, free of charge. It may go down, lose a score, or change. It isn't liable for any loss arising from your use of it, to the extent the law allows.",
    ],
  },
  {
    heading: "Changes and contact",
    body: [
      `These terms may change; the effective date above moves when they do. Questions: ${SUPPORT_EMAIL}.`,
    ],
  },
];
