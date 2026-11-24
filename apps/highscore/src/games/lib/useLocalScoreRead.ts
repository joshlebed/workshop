import { useEffect, useMemo, useState } from "react";
import { type LocalGameMatch, type LocalScoreRead, localScoreRead } from "./localRecognition";
import { loadScoreEngine, parseOnDevice, scoreEngineIfLoaded } from "./scoreEngine";

/**
 * What this device reads in `text` as a score for the game it recognized, or
 * null — when the game came with no parse code, while the engine is starting
 * (a few milliseconds, once), and when the code cannot read the text. Null
 * always means "wait for the server", never "no score".
 */
export function useLocalScoreRead(
  match: LocalGameMatch | null,
  text: string,
): LocalScoreRead | null {
  const parser = match?.parser ?? null;
  const unit = match?.scoreUnit ?? null;
  const [engine, setEngine] = useState(scoreEngineIfLoaded);
  const wanted = parser !== null;
  useEffect(() => {
    if (!wanted || engine) return;
    let current = true;
    void loadScoreEngine().then((loaded) => {
      if (current && loaded) setEngine(loaded);
    });
    return () => {
      current = false;
    };
  }, [wanted, engine]);

  const raw = text.trim();
  return useMemo(() => {
    if (!engine || !parser || !raw) return null;
    const result = parseOnDevice(engine, parser.code, raw);
    return result ? localScoreRead(result, unit) : null;
  }, [engine, parser, unit, raw]);
}
