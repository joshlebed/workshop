import { describe, expect, it } from "vitest";
import { localScoreRead } from "./localRecognition";
import { loadScoreEngine, parseOnDevice, scoreEngineIfLoaded } from "./scoreEngine";

const KRILLION = String.raw`function parse(raw) {
  var m = raw.match(/Krillion\s+#\d+[^\n]*\n\s*([\d,]+)/i);
  if (!m) throw new Error("not a Krillion share");
  return Number(m[1].replace(/,/g, ""));
}`;

describe("the on-device score engine", () => {
  it("is not loaded until something asks, then loads once", async () => {
    expect(scoreEngineIfLoaded()).toBeNull();
    const first = loadScoreEngine();
    expect(loadScoreEngine()).toBe(first);
    const engine = await first;
    expect(engine).not.toBeNull();
    expect(scoreEngineIfLoaded()).toBe(engine);
  }, 60_000);

  it("reads a share with the game's stored parse code", async () => {
    const engine = await loadScoreEngine();
    if (!engine) throw new Error("engine did not load");
    const read = parseOnDevice(engine, KRILLION, "Krillion #131 🦐\n1,402\n\n🏮🐟🫧");
    expect(read).toEqual({ kind: "score", value: 1402 });
    expect(read && localScoreRead(read, null)).toEqual({ kind: "score", value: 1402, unit: null });
  });

  it("reports what the code could not read as a failure, never a guess", async () => {
    const engine = await loadScoreEngine();
    if (!engine) throw new Error("engine did not load");
    const other = parseOnDevice(engine, KRILLION, "Wordle 1,127 3/6");
    expect(other).toMatchObject({ kind: "failed", reason: "threw" });
    expect(other && localScoreRead(other, null)).toBeNull();
    // Stored code gets the instruction budget here too.
    expect(parseOnDevice(engine, "function parse(raw) { for (;;) {} }", "x")).toMatchObject({
      kind: "failed",
      reason: "timeout",
    });
  });
});
