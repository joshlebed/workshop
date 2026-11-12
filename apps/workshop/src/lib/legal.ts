// Copy for Workshop's public pages, `/privacy` and `/terms` (UX pass 4.5).
//
// Modelled on HighScore's pages (`apps/highscore/src/lib/legal.ts`), adapted
// to what Workshop actually does: shared lists, no games. Everything here has
// to stay literally true of the shipped app, and claims go no further than
// HighScore's. `legal.test.ts` pins the data-handling claims. The operator
// reviews this text before it is linked from App Store Connect.

export const SUPPORT_EMAIL = "joshlebed@gmail.com";
export const PRIVACY_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Workshop privacy request")}`;
export const TERMS_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Workshop terms")}`;

/** Last time the privacy page's substance changed. Bump on every edit. */
export const PRIVACY_EFFECTIVE_DATE = "November 12, 2026";

/** Last time the terms page's substance changed. Bump on every edit. */
export const TERMS_EFFECTIVE_DATE = "November 12, 2026";

export interface LegalSection {
  heading: string;
  body?: string[];
  bullets?: string[];
}

export const PRIVACY_INTRO =
  "Workshop keeps what it needs to run your lists and share them with the people you choose, and nothing else. This is a plain description of what the app does with data. It is not legal advice.";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "What Workshop stores",
    bullets: [
      "Your account: email address, display name, user ID, and a profile picture if you add one.",
      "Your lists and what's on them: names, items, notes, links, tags, ranks, cover photos, and who added or completed what.",
      "Sharing: who is on each list, share links you create, and the activity on shared lists, so members can see what changed.",
      "Connections you choose to make: a Letterboxd username, and the public Letterboxd or Spotify lists you point a list at.",
      "How you arrived: if you signed up from a share link, which link it was, and on the web the page that sent you there.",
      "Security and session metadata: sign-in and refresh sessions, timestamps, and basic request details kept in server logs.",
      "Shares from other apps: when you share something into Workshop, a short preview of what arrived is written to the server logs, to help fix problems with sharing.",
    ],
  },
  {
    heading: "How it's used",
    body: [
      "Only to run the app and keep it secure: showing your lists, keeping shared lists in step for their members, looking up the movies, shows, books and links you add, and detecting abuse or breakage.",
      "A list is visible to its members. If you turn on its share link, anyone with the link can see the list, and can join it when the link allows joining. Turning the link off or resetting it stops that.",
      "To find movies, shows and books, and to preview links, Workshop's server asks outside services (such as TMDB and Google Books) for the title or link you typed. It sends what you searched for, not who you are.",
    ],
  },
  {
    heading: "Signing in",
    body: [
      "Sign-in is handled by Apple and Google. Workshop never sees or stores a password. It receives an identity token and the email address and name you choose to share, and Apple's Hide My Email works normally.",
    ],
  },
  {
    heading: "What Workshop never does",
    bullets: [
      "No selling or renting your data to anyone.",
      "No third-party advertising or ad networks in the app.",
      "No tracking you across other apps or websites, and no analytics SDKs that do.",
    ],
  },
  {
    heading: "Retention and deletion",
    body: [
      "Your account and lists are kept for as long as your account exists. Sign-in sessions expire on their own: they lapse after long inactivity and always end within a year. Server logs holding request metadata are deleted automatically after one year.",
      "You can delete your account at any time in the app: Settings, then Delete account. Deletion is immediate and permanent. Your profile and every list you own are removed, for everyone on them, along with the items you added and your activity on other people's lists. It can't be undone.",
      "Workshop and HighScore are one account, so deleting also removes your HighScore scores, friends and history.",
      "If you signed in with Apple, Workshop also asks Apple to revoke the sign-in tokens it holds for you. Google sign-in leaves nothing to revoke: Workshop only verifies an identity token and never requests ongoing access to your Google account.",
    ],
  },
  {
    heading: "Contact",
    body: [
      `Questions or corrections: email ${SUPPORT_EMAIL} and a person will answer. Deleting your account doesn't need an email; it's in the app.`,
    ],
  },
];

export const TERMS_INTRO =
  "Workshop is a place to keep lists with the people you share them with. These are the rules for using it, short and plain. Signing in means you agree to them.";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "Be decent on shared lists",
    body: [
      "Lists you share are seen by their members, and by anyone with the link when its share link is on. Don't put hateful, harassing, threatening or sexually explicit content on a list someone else can see, and don't use Workshop to abuse anyone.",
      "If something on a list shared with you is abusive, leave the list and email the address below. Reports are read by the person who runs Workshop, who may remove the content and close the account responsible.",
    ],
  },
  {
    heading: "Your account",
    bullets: [
      "You must be at least 13 years old to use Workshop.",
      "You're responsible for what's added from your account.",
      "Workshop and HighScore share one account; deleting it from either app deletes both. You can delete it at any time in Settings.",
      "Workshop may remove content or close an account that breaks these terms, without notice.",
    ],
  },
  {
    heading: "Other people's content",
    body: [
      "Titles, covers and details for movies, shows, books, albums and links come from their own sources (such as TMDB, Google Books, Spotify, Letterboxd and the pages you link). Workshop shows them to help you keep track and is not affiliated with any of them.",
    ],
  },
  {
    heading: "No warranty",
    body: [
      "Workshop is provided as-is by one person, free of charge. It may go down, lose something, or change. It isn't liable for any loss arising from your use of it, to the extent the law allows.",
    ],
  },
  {
    heading: "Changes and contact",
    body: [
      `These terms may change; the effective date above moves when they do. Questions: ${SUPPORT_EMAIL}.`,
    ],
  },
];
