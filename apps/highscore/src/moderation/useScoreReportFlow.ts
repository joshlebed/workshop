// Chains "Report this score…" (a row inside the reaction picker sheet) into
// the ReportSheet without stacking two RN Modals: the picker closes first, and
// its `onClosed` (fired after the exit animation) promotes the pending target
// into the report sheet. See the Sheet-stacking gotcha in the root CLAUDE.md.

import { useCallback, useRef, useState } from "react";
import type { ReportTarget } from "./ReportSheet";

export function useScoreReportFlow(closePicker: () => void) {
  const pendingRef = useRef<ReportTarget | null>(null);
  const [target, setTarget] = useState<ReportTarget | null>(null);

  const requestReport = useCallback(
    (t: ReportTarget) => {
      pendingRef.current = t;
      closePicker();
    },
    [closePicker],
  );

  const onPickerClosed = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) setTarget(p);
  }, []);

  const close = useCallback(() => setTarget(null), []);

  return { target, requestReport, onPickerClosed, close };
}
