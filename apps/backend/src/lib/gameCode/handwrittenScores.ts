// PROTOTYPE — the score each `handwritten.ts` example's parser reads, in
// example order (undefined = no parser / a URL-only share; null = a loss).
// Shared by the heuristic-formatter test and the generated-formatter live run.

export const HANDWRITTEN_SCORE_VALUES: Record<string, ReadonlyArray<number | null | undefined>> = {
  wordle: [4, 3, undefined],
  "wordle.louan.me": [4, null],
  "spotle.io": [4, null],
  framed: [3, null],
  strands: [1, undefined],
  "spelling-bee": [undefined, undefined],
  "krillion.io": [360, 415],
  "geozee.earth": [784],
  "farflung.game": [195, 155],
  "magnitudle.com/size-it-up": [268],
  "fermi.gg": [4.36, 42.9],
  "gerrymandle.com": [467],
  "minutecryptic.com": [0, 2],
  "timeguessr.com": [29530],
};
