import { describe, expect, it } from "vitest";
import {
  type GameRecognizer,
  recognizerEvidence,
  recognizeWithRecognizers,
} from "./gameRecognition.js";

const mini = (date: string, time: string) =>
  `I solved the ${date} New York Times Mini Crossword in ${time}!`;
const MINI_EXAMPLES = [
  mini("5/20/2026", "0:16"),
  mini("5/21/2026", "1:02"),
  mini("5/22/2026", "0:48"),
];
const geo = (name: string, site: string, score: number) =>
  `${name} · Oct 2nd\n${score} / 1,000\n🟢🟡🟡🟢🟡\n${site}`;

function recognizer(
  fields: Pick<GameRecognizer, "id" | "title" | "normalizedUrl"> & Partial<GameRecognizer>,
  examples: string[] = [],
): GameRecognizer {
  return {
    url: `https://${fields.normalizedUrl}`,
    inMyGames: true,
    curated: false,
    ...recognizerEvidence(examples),
    ...fields,
  };
}

describe("recognizerEvidence", () => {
  it("keeps the tokens most examples share, never the texts", () => {
    const evidence = recognizerEvidence(MINI_EXAMPLES);
    expect(evidence.examples).toBe(3);
    expect(evidence.fingerprint).toMatchObject({ "w:crossword": 1, "w:mini": 1, "n:9:9!": 1 });
    // That day's values are not invariant.
    expect(Object.keys(evidence.fingerprint ?? {}).some((t) => t.includes("0:16"))).toBe(false);
  });

  it("has no fingerprint below three examples: one text is one player's wording", () => {
    expect(recognizerEvidence([MINI_EXAMPLES[0] as string])).toMatchObject({
      examples: 1,
      fingerprint: null,
    });
    expect(recognizerEvidence([])).toEqual({ examples: 0, fingerprint: null, hosts: [] });
  });

  it("carries a host only when two examples link it", () => {
    const evidence = recognizerEvidence([
      "Score 10 play.example.com",
      "Score 12 https://www.play.example.com/x",
      "Score 9 my-own-blog.net",
    ]);
    expect(evidence.hosts).toEqual(["play.example.com"]);
  });
});

describe("recognizeWithRecognizers", () => {
  const maptap = recognizer({ id: "maptap", title: "MapTap", normalizedUrl: "maptap.gg" });
  const krillion = recognizer({
    id: "krillion",
    title: "Krillion · the daily dive",
    normalizedUrl: "krillion.io",
  });
  const nytMini = recognizer(
    { id: "mini", title: "NYT Mini", normalizedUrl: "nytimes.com/crosswords/game/mini" },
    MINI_EXAMPLES,
  );
  const mine = [maptap, krillion, nytMini];

  it("names a game by its link, its name, and its shape", () => {
    expect(recognizeWithRecognizers("www.maptap.gg May 27\nFinal score: 770", mine)).toEqual({
      gameId: "maptap",
      method: "url",
      confidence: 0.99,
    });
    expect(recognizeWithRecognizers("Krillion #77 🦐\n305", mine)).toMatchObject({
      gameId: "krillion",
      method: "label",
    });
    expect(recognizeWithRecognizers(mini("6/01/2026", "0:13"), mine)).toMatchObject({
      gameId: "mini",
      method: "fingerprint",
    });
  });

  it("says nothing for prose, an empty text, or a shape it has no fingerprint for", () => {
    expect(recognizeWithRecognizers("anyone playing krillion today?", mine)).toBeNull();
    expect(recognizeWithRecognizers("   ", mine)).toBeNull();
    expect(recognizeWithRecognizers("98🎯 95🏅 92🏆\nFinal score: 947", mine)).toBeNull();
    expect(recognizeWithRecognizers("Krillion #77 🦐\n305", [])).toBeNull();
  });

  it("recognizes a listed game outside My Games by link, and by name only when curated", () => {
    const wordle = recognizer({
      id: "wordle",
      title: "Wordle",
      normalizedUrl: "nytimes.com/games/wordle",
      inMyGames: false,
      curated: true,
    });
    const farflung = recognizer({
      id: "farflung",
      title: "Farflung",
      normalizedUrl: "farflung.game",
      inMyGames: false,
    });
    const all = [...mine, wordle, farflung];
    expect(recognizeWithRecognizers("Wordle 1,127 3/6\n⬜🟨⬜⬜⬜", all)).toMatchObject({
      gameId: "wordle",
      method: "label",
    });
    expect(recognizeWithRecognizers("Farflung #12 4/6", all)).toBeNull();
    expect(recognizeWithRecognizers("Farflung #12 4/6 https://farflung.game", all)).toMatchObject({
      gameId: "farflung",
      method: "url",
    });
  });

  it("does not let a shape decide when the text links a site that game never does", () => {
    const history = recognizer(
      { id: "geohistory", title: "GeoHistory", normalizedUrl: "geohistory.gg" },
      [
        geo("GeoHistory", "www.geohistory.gg", 887),
        geo("GeoHistory", "www.geohistory.gg", 640),
        geo("GeoHistory", "www.geohistory.gg", 712),
      ],
    );
    expect(history.hosts).toEqual(["geohistory.gg"]);
    // Same layout, another site: the name is not GeoHistory's and neither is the link.
    expect(recognizeWithRecognizers(geo("Quizzo", "www.quizzo.app", 616), [history])).toBeNull();
    // The same shape with no link at all is GeoHistory's to claim.
    expect(
      recognizeWithRecognizers("Round · Oct 2nd\n702 / 1,000\n🟢🟡🟡🟢🟡", [history]),
    ).toMatchObject({ gameId: "geohistory", method: "fingerprint" });
  });

  it("leaves a text that names two games to the server", () => {
    expect(recognizeWithRecognizers("Krillion #77 305 and MapTap 770", mine)).toBeNull();
  });
});
