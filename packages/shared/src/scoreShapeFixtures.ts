// The 19 share shapes found in prod `game_scores.score_raw` (survey of
// 2026-10-04), one representative text each, with which feature is the score.
// Test data only: shared by the candidate tests here and the teach tests in
// the backend, so both sides are checked against the same shapes. The texts
// are made up to the surveyed shapes — none is a real player's paste.

import type { GameScoreDirection } from "./games.js";
import type { ScoreFeature, ScoreFeatureKind } from "./scoreCandidates.js";

export interface ScoreShapeFixture {
  key: string;
  title: string;
  normalizedUrl: string;
  raw: string;
  /** Which computed feature is the score. */
  pick: { kind: ScoreFeatureKind; text?: string; symbol?: string };
  value: number;
  direction: GameScoreDirection;
  /** A share of the same game that is a loss — the parser must say "no result". */
  loss?: string;
}

/** The feature a fixture's `pick` names among a text's computed features. */
export function fixtureFeature(
  features: readonly ScoreFeature[],
  pick: ScoreShapeFixture["pick"],
): ScoreFeature | undefined {
  return features.find(
    (f) =>
      f.kind === pick.kind &&
      (pick.text === undefined || f.text === pick.text) &&
      (pick.symbol === undefined || f.symbol === pick.symbol),
  );
}

export const SCORE_SHAPE_FIXTURES: ScoreShapeFixture[] = [
  {
    key: "maptap",
    title: "MapTap",
    normalizedUrl: "maptap.gg",
    raw: "www.maptap.gg October 6\n93🔥 88🔥 97🔥 71✨ 55🙂\nFinal score: 812",
    pick: { kind: "number", text: "812" },
    value: 812,
    direction: "desc",
  },
  {
    key: "dailytens",
    title: "Daily Tens",
    normalizedUrl: "dailytens.com",
    raw: "DailyTens #412\n\n  🏆   ❌\n  🏆   🏆\n  ❌   🏆\n  🏆   🏆\n  🏆   ❌\nhttps://dailytens.com/?ref=944415",
    pick: { kind: "symbolCount", symbol: "🏆" },
    value: 7,
    direction: "desc",
  },
  {
    key: "globle",
    title: "Globle",
    normalizedUrl: "globle-game.com",
    raw: "🌎 Oct 6, 2026 🌍\n🔥 12 | Avg. Guesses: 6.4\n🟥🟧🟨🟩 = 5\n\nhttps://globle-game.com\n#globle",
    pick: { kind: "number", text: "5" },
    value: 5,
    direction: "asc",
  },
  {
    key: "satle",
    title: "Satle",
    normalizedUrl: "satle.ca",
    raw: "🛰Satle #512 3/6\n🟥🟥🟩\nhttps://satle.ca",
    pick: { kind: "fraction", text: "3/6" },
    value: 3,
    direction: "asc",
    loss: "🛰Satle #512 X/6\n🟥🟥🟥🟥🟥🟥\nhttps://satle.ca",
  },
  {
    key: "travle",
    title: "Travle",
    normalizedUrl: "travle.earth",
    raw: "#travle #1021 +2\n✅✅🟧✅🟧✅\nhttps://travle.earth",
    pick: { kind: "plus", text: "+2" },
    value: 2,
    direction: "asc",
    loss: "#travle #1021 (3 away)\n🟧🟥🟥🟧🟥🟥🟥\nhttps://travle.earth",
  },
  {
    key: "tradle",
    title: "Tradle",
    normalizedUrl: "tradle.net",
    raw: "#Tradle #1300 4/6\n🟩🟩🟨⬜⬜\n🟩🟩🟩🟨⬜\n🟩🟩🟩🟩🟨\n🟩🟩🟩🟩🟩\nhttps://tradle.net/",
    pick: { kind: "fraction", text: "4/6" },
    value: 4,
    direction: "asc",
    loss: "#Tradle #1300 X/6\n🟩🟨⬜⬜⬜\n🟩🟩⬜⬜⬜\n🟩🟩🟨⬜⬜\n🟩🟩🟩⬜⬜\n🟩🟩🟩🟨⬜\n🟩🟩🟩🟩⬜\nhttps://tradle.net/",
  },
  {
    key: "geosports",
    title: "GeoSports",
    normalizedUrl: "geosports.app",
    raw: "GeoSports · October 6th\n711 / 1,000\n🟢🟡🟡🟢🟡\nwww.geosports.app",
    pick: { kind: "fraction", text: "711 / 1,000" },
    value: 711,
    direction: "desc",
  },
  {
    key: "nytmini",
    title: "NYT Mini",
    normalizedUrl: "nytimes.com/crosswords/game/mini",
    raw: "I solved the 10/6/2026 New York Times Mini Crossword in 0:42!\nhttps://www.nytimes.com/crosswords/game/mini",
    pick: { kind: "duration", text: "0:42" },
    value: 42,
    direction: "asc",
  },
  {
    key: "worldle",
    title: "Worldle",
    normalizedUrl: "worldle.teuteuf.fr",
    raw: "#Worldle #1450 (06.10.2026) 3/6 (94%)\n🔥 Current Win Streak: 7 days\n🟩🟩🟨⬛⬛↗️\n🟩🟩🟩🟩⬛⬆️\n🟩🟩🟩🟩🟩🎉\n\nhttps://worldle.teuteuf.fr",
    pick: { kind: "fraction", text: "3/6" },
    value: 3,
    direction: "asc",
    loss: "#Worldle #1450 (06.10.2026) X/6 (71%)\n🟩🟨⬛⬛⬛↗️\n🟩🟩⬛⬛⬛⬆️\n🟩🟩🟨⬛⬛↖️\n🟩🟩🟩⬛⬛⬅️\n🟩🟩🟩🟨⬛↙️\n🟩🟩🟩🟩⬛⬇️\n\nhttps://worldle.teuteuf.fr",
  },
  {
    key: "geohistory",
    title: "GeoHistory",
    normalizedUrl: "geohistory.gg",
    raw: "GeoHistory · Oct 6th\n650 / 1,000\n🟢🟡🔴🟢🟡\nwww.geohistory.gg",
    pick: { kind: "fraction", text: "650 / 1,000" },
    value: 650,
    direction: "desc",
  },
  {
    key: "geozee",
    title: "Geozee",
    normalizedUrl: "geozee.earth",
    raw: "Geozee #15 — 609/809 · top 12% 🌍\n🇫🇷🇩🇪🇯🇵🇧🇷🇨🇦🇮🇳🇲🇽🇰🇪🇳🇴\n\n🟩🟩🟨\n🟩⬛🟩\n🟨🟩🟩\n\nhttps://geozee.earth?ref=share",
    pick: { kind: "fraction", text: "609/809" },
    value: 609,
    direction: "desc",
  },
  {
    key: "wordle",
    title: "Wordle",
    normalizedUrl: "nytimes.com/games/wordle",
    raw: "Wordle 1,573 4/6\n\n⬛🟨⬛⬛⬛\n🟨⬛🟩⬛⬛\n⬛🟩🟩🟨⬛\n🟩🟩🟩🟩🟩",
    pick: { kind: "fraction", text: "4/6" },
    value: 4,
    direction: "asc",
    loss: "Wordle 1,573 X/6\n\n⬛🟨⬛⬛⬛\n🟨⬛🟩⬛⬛\n⬛🟩🟩🟨⬛\n⬛🟩🟩🟩⬛\n🟨🟩🟩🟩⬛\n⬛🟩🟩🟩🟩",
  },
  {
    key: "anthropeum",
    title: "Anthropeum",
    normalizedUrl: "anthropeum.com",
    raw: "Anthropeum.com · Oct 6 2026\n🟩🟩🟨🟥🟩\n4,250 · top 18% of players today!",
    pick: { kind: "number", text: "4,250" },
    value: 4250,
    direction: "desc",
  },
  {
    key: "connections",
    title: "Connections",
    normalizedUrl: "nytimes.com/games/connections",
    raw: "Connections\nPuzzle #850\n🟨🟨🟨🟨\n🟩🟪🟩🟩\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪",
    pick: { kind: "rowCount" },
    value: 5,
    direction: "asc",
  },
  {
    key: "krillion",
    title: "Krillion",
    normalizedUrl: "krillion.io",
    raw: "Krillion #81 🦐\n415\n\n🦑🏮🫧🦑🫧🏮",
    pick: { kind: "number", text: "415" },
    value: 415,
    direction: "desc",
  },
  {
    key: "minutecryptic",
    title: "Minute Cryptic",
    normalizedUrl: "minutecryptic.com",
    raw: 'Minute Cryptic - 6 October, 2026\n"Unhappy about first of rain, sadly" (6)\n⚪️🟣⚪️⚪️🟣⚪️\n🤝 2 hints – matched the community par (2)\nhttps://www.minutecryptic.com/?utm_source=share',
    pick: { kind: "number", text: "2" },
    value: 2,
    direction: "asc",
  },
  {
    key: "gerrymandle",
    title: "Gerrymandle",
    normalizedUrl: "gerrymandle.com",
    raw: "Gerrymandle #96\nWon the election in 1:23!\n💎🏆 Perfect game\n\nhttps://gerrymandle.com",
    pick: { kind: "duration", text: "1:23" },
    value: 83,
    direction: "asc",
  },
  {
    key: "sizeitup",
    title: "Size It Up",
    normalizedUrl: "magnitudle.com/size-it-up",
    raw: "Size It Up\nOverall Score 87\n🟩🟩🟩🟩🟩🟩🟩🟩🟨⬛\n🟩🟩🟩🟩🟩🟩🟩🟩🟩⬛\n🟩🟩🟩🟩🟩🟩🟩🟨⬛⬛\n🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩\n🟩🟩🟩🟩🟩🟩🟨⬛⬛⬛\nhttps://magnitudle.com/size-it-up",
    pick: { kind: "number", text: "87" },
    value: 87,
    direction: "desc",
  },
  {
    key: "ethnoguessr",
    title: "EthnoGuessr",
    normalizedUrl: "hbd.gg/play",
    raw: "I scored an average of 4120 over 10 rounds in today's EthnoGuessr! Can you beat my score of 4890 points on round 3? Play now at https://hbd.gg/play/!",
    pick: { kind: "number", text: "4120" },
    value: 4120,
    direction: "desc",
  },
];
