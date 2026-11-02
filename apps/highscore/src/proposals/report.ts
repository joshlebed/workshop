// Copy for the proposals page: what each option is, where it comes from,
// which principles it leans on, and what it costs.
export interface Proposal {
  id: "a" | "b" | "c";
  name: string;
  tagline: string;
  summary: string;
  priorArt: string[];
  principles: string[];
  tradeoffs: string[];
  bestWhen: string;
}

export const PROPOSALS: Proposal[] = [
  {
    id: "a",
    name: "A · You, as a page",
    tagline: "The avatar opens a profile screen, not a menu.",
    summary:
      "Tap your avatar and you land on a full page about you: name and photo, today's numbers (played / best streak / friends), pending requests with inline Accept, a row of friend avatars with See all, then a short grouped settings list. Legal links shrink to a footer line.",
    priorArt: [
      "NYT Games “Me” tab: profile + stats on top, settings behind a gear.",
      "Strava “You”: identity, then activity, then settings far down.",
      "Duolingo Profile: stats strip, friends module, gear for the rest.",
    ],
    principles: [
      "Frequency ordering: daily things (requests, friends, streak) above rare things (legal, sign out).",
      "Recognition over recall: the page shows your state instead of listing verbs.",
      "Progressive disclosure: settings are one quiet group; friends get a preview, not the whole list.",
    ],
    tradeoffs: [
      "Sign out and legal become two taps (fine: they are rare).",
      "One more full screen in the navigation stack; back button must be obvious.",
      "Needs real stats to feel alive; an empty new account shows zeros.",
    ],
    bestWhen:
      "You want one place that is “me” and you expect the profile to grow (stats, badges, history).",
  },
  {
    id: "b",
    name: "B · Friends in the header, account in a small sheet",
    tagline: "Two triggers, two jobs.",
    summary:
      "A friends icon (with the request badge) sits next to your avatar in the home header and opens the Friends page directly. The avatar opens a tiny sheet: you, Edit profile, Sign out. Help, legal and admin live behind a gear on the Friends page.",
    priorArt: [
      "Duolingo: Friends is a destination; the gear on Profile holds settings.",
      "Instagram: notifications (social) and profile (identity) are separate header targets.",
      "Apple Game Center: friends list is its own surface; account is a small card.",
    ],
    principles: [
      "Separate the social loop from identity: a badge on “friends” means friends, not “something about you”.",
      "Zero-tap visibility: the pending-request count is visible without opening anything.",
      "Keep the sheet, but make it earn its size: three items, no scrolling.",
    ],
    tradeoffs: [
      "Three icons in the header (copy, friends, avatar) crowds a 390px phone.",
      "Settings end up on the Friends page, which is a slightly odd home for Terms of use.",
      "Two entry points to learn instead of one.",
    ],
    bestWhen:
      "Friend requests and friends’ activity are the thing you open the app for, and you want them one tap from home.",
  },
  {
    id: "c",
    name: "C · Friends hub, you included",
    tagline: "The avatar opens the social loop; everything else is overflow.",
    summary:
      "One screen: your own row on top (tap to edit profile), friends sorted by who played today with their game counts, requests, people you may know. A ⋯ overflow holds feedback, support, legal, admin and sign out. The invite is a + in the nav.",
    priorArt: [
      "Snapchat / BeReal friends screens: you first, then friends by recency.",
      "Discord friends list: activity-sorted rows, utilities in a kebab.",
      "Letterboxd “You”: content first, settings behind an overflow.",
    ],
    principles: [
      "Single focus: the only question this screen answers is “who is playing, and am I?”.",
      "Activity as hierarchy: friends who played today float up and show a number; quiet friends fade down.",
      "Minimal choices: one primary action (+ invite), one overflow, nothing else competing.",
    ],
    tradeoffs: [
      "Edit profile and Sign out are the least discoverable here (a row tap and a kebab).",
      "Per-friend activity needs a new backend field (last played / games today); this prototype fakes it.",
      "Feels like a social app page; if HighScore should stay small and quiet this may be too much.",
    ],
    bestWhen:
      "The friends list is the product’s second home screen and you are ready to surface per-friend activity.",
  },
];
