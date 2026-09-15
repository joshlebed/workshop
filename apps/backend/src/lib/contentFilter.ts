// Objectionable-content filter for user-authored text (App Store Review
// Guideline 1.2 — "a method for filtering objectionable content").
//
// Applied at write time to the two strings other people see on a leaderboard:
// display names (`PATCH /v1/users/me`) and pasted score text
// (`PUT /v1/games/:id/scores`). Rejected writes 400 with `OBJECTIONABLE_CONTENT`
// so the client can say "that can't be posted" instead of a generic error.
//
// Deliberately conservative. Game results are full of random letter runs
// (Wordle guesses, emoji grids, hex-ish tokens), so a broad profanity list
// would reject legitimate scores. The list below is slurs and hard abuse that
// have no innocent reading; ordinary swearing is left to report + block.
// Matching is whole-word after normalising case, accents, common leet
// substitutions, and separators — "n1gg3r" and "n.i.g.g.e.r" both hit,
// "night" and "assess" do not.

const BLOCKED_TERMS = [
  "nigger",
  "nigga",
  "niggers",
  "niggas",
  "faggot",
  "faggots",
  "fag",
  "fags",
  "kike",
  "kikes",
  "spic",
  "spics",
  "chink",
  "chinks",
  "wetback",
  "wetbacks",
  "tranny",
  "trannies",
  "retard",
  "retards",
  "retarded",
  "cunt",
  "cunts",
  "raghead",
  "ragheads",
  "gook",
  "gooks",
  "beaner",
  "beaners",
  "dyke",
  "dykes",
  "kys",
  "killyourself",
  "rapist",
  "heilhitler",
];

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "i",
};

/** Lowercase, strip accents, map leet, drop everything that isn't a letter. */
function normalizeToken(token: string): string {
  const lowered = token.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  let out = "";
  for (const ch of lowered) {
    const mapped = LEET[ch] ?? ch;
    if (/[a-z]/.test(mapped)) out += mapped;
  }
  return out;
}

const BLOCKED = new Set(BLOCKED_TERMS.map(normalizeToken));

/**
 * Candidate tokens from free text: whitespace-separated words, plus each word
 * with inner punctuation removed ("n.i.g.g.e.r" → "nigger") and the whole
 * text collapsed ("kill yourself" → "killyourself").
 */
function candidateTokens(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const tokens = new Set<string>();
  for (const word of words) {
    tokens.add(normalizeToken(word));
    for (const part of word.split(/[^\p{L}\p{N}@$!|]+/u)) {
      if (part) tokens.add(normalizeToken(part));
    }
  }
  // Two-word phrases (and the collapsed pair) for multi-word entries.
  for (let i = 0; i + 1 < words.length; i++) {
    tokens.add(normalizeToken(`${words[i]}${words[i + 1]}`));
  }
  tokens.delete("");
  return [...tokens];
}

/** True when the text contains a blocked term as a whole word. */
export function containsObjectionableContent(text: string): boolean {
  return candidateTokens(text).some((token) => BLOCKED.has(token));
}

export const OBJECTIONABLE_CONTENT_MESSAGE =
  "That text can't be posted on HighScore. Slurs and abusive language aren't allowed.";
