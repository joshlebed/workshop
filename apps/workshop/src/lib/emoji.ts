/**
 * The first emoji in what someone typed or pasted into the list emoji field
 * (3.4), or null when there is none. Keeps a whole grapheme (flags, skin
 * tones, ZWJ sequences) and stays within the backend's 10-unit limit.
 */
export function firstEmoji(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const graphemes = Segmenter
    ? Array.from(
        new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
        (s) => s.segment,
      )
    : Array.from(text);
  for (const g of graphemes) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g) && g.length <= 10) return g;
  }
  return null;
}
