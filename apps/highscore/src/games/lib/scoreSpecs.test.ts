import { describe, expect, it } from "vitest";
import { previewScore, scorePreviewCaption } from "./scoreSpecs";

const wordleSpec = {
  rules: [{ kind: "capture" as const, pattern: "Wordle\\s+[\\d,]+\\s+(\\d+)/6" }],
};

describe("scorePreviewCaption", () => {
  const localScore = previewScore("Wordle 1,127 3/6", wordleSpec);
  const localMiss = previewScore("Wordle 1,127 X/6", wordleSpec);

  it("with no server preview, says what the local parser reads — as before", () => {
    expect(scorePreviewCaption(null, localScore)).toBe("Recording score: 3");
    expect(scorePreviewCaption(null, localMiss)).toBe(
      "Couldn't read a score in this. It'll post as “Played”.",
    );
    expect(scorePreviewCaption(null, null)).toBe(null);
  });

  it("prefers the server's reading over the local one", () => {
    // The server fixed Worldle's date bug; the local registry regex has not.
    const server = { parseStatus: "score" as const, scoreValue: 5, scoreSummary: "🟩 2·5 5/6" };
    expect(scorePreviewCaption(server, localMiss)).toBe("Recording score: 5");
    expect(scorePreviewCaption(server, null)).toBe("Recording score: 5");
  });

  it("tells a loss from a share the game's code could not read", () => {
    const loss = { parseStatus: "no_result" as const, scoreValue: null, scoreSummary: "🟩 3 X/6" };
    const failed = { parseStatus: "failed" as const, scoreValue: null, scoreSummary: "hi" };
    expect(scorePreviewCaption(loss, localMiss)).toBe("No score today. This posts and ranks last.");
    expect(scorePreviewCaption(failed, localScore)).toBe(
      "Couldn't read a score in this. It'll post without a rank.",
    );
  });
});
