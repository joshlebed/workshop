// The teach flow's structured log lines (spec "Observability"). One line per
// event, each with a `kind` and — where they exist — the request id, user,
// game, puzzle day and parser version, so an operator can reconstruct a bug
// report from `scripts/logs.sh --filter <request_id>` without asking the
// user. Raw score text is logged on purpose: it is already stored in
// `game_scores.score_raw`.

import { logger } from "../logger.js";

type TeachLogKind =
  | "score_parse"
  | "score_preview"
  | "score_input_rejected"
  | "score_pick"
  | "parser_accept"
  | "pick_conflict"
  | "direction_change"
  | "game_recognition"
  | "sandbox_failure"
  | "parser_rollback";

/** The fields every event carries when it has them. */
export interface TeachLogContext {
  requestId?: string | undefined;
  userId?: string | undefined;
  gameId?: string | undefined;
  periodKey?: string | undefined;
  parserVersion?: number | undefined;
}

export function logTeachEvent(
  kind: TeachLogKind,
  context: TeachLogContext,
  fields: Record<string, unknown> = {},
): void {
  logger.info(kind, {
    kind,
    request_id: context.requestId ?? null,
    user_id: context.userId ?? null,
    game_id: context.gameId ?? null,
    period_key: context.periodKey ?? null,
    parser_version: context.parserVersion ?? null,
    ...fields,
  });
}
