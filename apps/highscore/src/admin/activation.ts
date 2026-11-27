// Pure formatting for the admin "2-3-1" activation table and push funnel
// (`ActivationTable.tsx`). The server does every count; this only turns a
// `{ reached, eligible }` cell into what the table prints.

import type { AdminActivationCell, AdminPushFunnelRow } from "@workshop/shared";
import { PUSH_PROMPT_STAGES, type PushPromptStage } from "@workshop/shared/constants";

export interface FormattedCell {
  /** `56%`, or `—` when nobody in the row is old enough to count yet. */
  pct: string;
  /** `9/16`; empty with `—`. */
  ratio: string;
}

export function formatActivationCell(cell: AdminActivationCell): FormattedCell {
  if (cell.eligible <= 0) return { pct: "—", ratio: "" };
  return {
    pct: `${Math.round((cell.reached / cell.eligible) * 100)}%`,
    ratio: `${cell.reached}/${cell.eligible}`,
  };
}

export const ACTIVATION_COLUMNS = [
  { key: "firstScore", label: "Score d1" },
  { key: "twoFriends", label: "2 friends d1" },
  { key: "threeGames", label: "3 games d1" },
  { key: "all", label: "2-3-1" },
  { key: "backAfterDay7", label: "Back after d7" },
] as const;

export const PUSH_STAGE_LABELS: Record<PushPromptStage, string> = {
  shown: "Shown",
  accepted: "Accepted",
  declined: "Declined",
  os_granted: "OS granted",
  os_denied: "OS denied",
};

/** The stage counts of one funnel row in `PUSH_PROMPT_STAGES` order (missing = 0). */
export function funnelCounts(row: AdminPushFunnelRow): { stage: PushPromptStage; value: number }[] {
  return PUSH_PROMPT_STAGES.map((stage) => ({ stage, value: row.stages[stage] ?? 0 }));
}
