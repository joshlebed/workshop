// The HighScore "2-3-1" activation table and the push-permission funnel on the
// admin dashboard (`GET /v1/admin/analytics?client=highscore`).
//
// Cohort = HighScore accounts created in one UTC week (Monday start): a
// `users` row created that week that has made a HighScore request
// (`user_activity_days.client = 'highscore'`) or has a game. For each cohort:
//   - day-1 cells: reached the milestone (`user_milestones.reached_at`) less
//     than 24h after `users.created_at` — first score, second friend, third
//     game, and all three ("2-3-1"). Only members at least 24h old count in
//     the denominator (`eligible`).
//   - back after day 7: took a HighScore action (`actionRows`) on a UTC day at
//     least 7 days after the signup's UTC day; only members whose signup day
//     is 7+ days ago are eligible.
// `bySource` pools the same weeks by `users.signup_source`.
//
// The arithmetic is the pure `buildActivationCohorts`, unit-tested; the
// loaders below only fetch rows.

import type {
  AdminActivationCell,
  AdminActivationCohorts,
  AdminActivationRow,
  AdminPushFunnel,
  AdminPushFunnelRow,
} from "@workshop/shared";
import {
  type MilestoneKey,
  PUSH_PROMPT_STAGES,
  PUSH_PROMPT_TRIGGERS,
  type PushPromptStage,
} from "@workshop/shared/constants";
import { sql } from "drizzle-orm";
import type { getDb } from "../db/client.js";
import { executeRows } from "./sql.js";
import { utcDay } from "./userActivity.js";

type Db = ReturnType<typeof getDb>;

const DAY_MS = 86_400_000;
const ACTIVATION_WEEKS = 12;
const DAY1_KEYS = ["first_score", "second_friend", "third_game"] as const satisfies MilestoneKey[];

export interface CohortMember {
  userId: string;
  createdAt: Date;
  signupSource: string | null;
}

/** Monday (UTC) of the week containing `d`, as `YYYY-MM-DD`. */
export function utcWeekStart(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const back = (day.getUTCDay() + 6) % 7;
  return utcDay(new Date(day.getTime() - back * DAY_MS));
}

function addDays(day: string, delta: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS));
}

const SOURCE_ROWS: { key: string; label: string; matches: (s: string | null) => boolean }[] = [
  { key: "friend_invite", label: "Friend invite", matches: (s) => s === "friend_invite" },
  { key: "play_link", label: "Play link", matches: (s) => s === "play_link" },
  { key: "none", label: "None (App Store / direct)", matches: (s) => s === "none" },
  {
    key: "other",
    label: "Other (list invite, web referral)",
    matches: (s) => s !== null && !["friend_invite", "play_link", "none"].includes(s),
  },
  { key: "unrecorded", label: "Not recorded (predates attribution)", matches: (s) => s === null },
];

function weekLabel(start: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  return `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

function cell(): AdminActivationCell {
  return { reached: 0, eligible: 0 };
}

function rowFor(
  key: string,
  label: string,
  members: CohortMember[],
  milestones: Map<string, Map<string, Date>>,
  lastActionDay: Map<string, string>,
  now: Date,
): AdminActivationRow {
  const row: AdminActivationRow = {
    key,
    label,
    signups: members.length,
    firstScore: cell(),
    twoFriends: cell(),
    threeGames: cell(),
    all: cell(),
    backAfterDay7: cell(),
  };
  const today = utcDay(now);
  for (const m of members) {
    const signup = m.createdAt.getTime();
    if (now.getTime() - signup >= DAY_MS) {
      const mine = milestones.get(m.userId);
      const within = (k: MilestoneKey) => {
        const at = mine?.get(k);
        return at !== undefined && at.getTime() - signup < DAY_MS;
      };
      const hits = DAY1_KEYS.map(within);
      const [score, friends, games] = hits;
      for (const c of [row.firstScore, row.twoFriends, row.threeGames, row.all]) c.eligible += 1;
      if (score) row.firstScore.reached += 1;
      if (friends) row.twoFriends.reached += 1;
      if (games) row.threeGames.reached += 1;
      if (hits.every(Boolean)) row.all.reached += 1;
    }
    const day7 = addDays(utcDay(m.createdAt), 7);
    if (today >= day7) {
      row.backAfterDay7.eligible += 1;
      const last = lastActionDay.get(m.userId);
      if (last !== undefined && last >= day7) row.backAfterDay7.reached += 1;
    }
  }
  return row;
}

/**
 * The activation table from already-loaded rows. `members` should cover the
 * last `weeks` signup weeks; `milestones` is userId → key → reached_at;
 * `lastActionDay` is userId → latest HighScore action day (`YYYY-MM-DD`).
 */
export function buildActivationCohorts(
  members: CohortMember[],
  milestones: Map<string, Map<string, Date>>,
  lastActionDay: Map<string, string>,
  now: Date,
  weeks = ACTIVATION_WEEKS,
): AdminActivationCohorts {
  const current = utcWeekStart(now);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(current, -7 * i));
  const oldest = starts[starts.length - 1] ?? current;
  const inWindow = members.filter((m) => utcWeekStart(m.createdAt) >= oldest);

  const byWeek = new Map<string, CohortMember[]>();
  for (const m of inWindow) {
    const w = utcWeekStart(m.createdAt);
    const list = byWeek.get(w) ?? [];
    list.push(m);
    byWeek.set(w, list);
  }

  return {
    label: "Activation by signup week (2-3-1)",
    description:
      "HighScore accounts created each UTC week (Monday start). Day-1 columns: share who posted a first score, had 2 friends, had 3 games, and all three, within 24h of creating the account; only accounts at least 24h old count. Back after day 7: share who posted, added a game, reacted, poked or made a friend on a UTC day 7+ days after signup; only accounts 7+ days old count. Milestones before this table shipped are backfilled from current friends / games, so removed ones are missing.",
    weeks: starts.map((start) =>
      rowFor(start, weekLabel(start), byWeek.get(start) ?? [], milestones, lastActionDay, now),
    ),
    bySource: SOURCE_ROWS.map((s) =>
      rowFor(
        s.key,
        s.label,
        inWindow.filter((m) => s.matches(m.signupSource)),
        milestones,
        lastActionDay,
        now,
      ),
    ).filter((r) => r.signups > 0),
  };
}

/** Load the cohort members and their day-1 milestones for the last `weeks` weeks. */
export async function loadActivationInputs(db: Db, now: Date, weeks = ACTIVATION_WEEKS) {
  const since = new Date(
    Date.parse(`${addDays(utcWeekStart(now), -7 * (weeks - 1))}T00:00:00Z`),
  ).toISOString();
  const memberRows = await executeRows<{
    userId: string;
    createdAt: string | Date;
    signupSource: string | null;
  }>(
    db,
    sql`
      SELECT u.id AS "userId", u.created_at AS "createdAt", u.signup_source AS "signupSource"
      FROM users u
      WHERE u.created_at >= ${since}::timestamptz
        AND (
          EXISTS (SELECT 1 FROM user_activity_days a WHERE a.user_id = u.id AND a.client = 'highscore')
          OR EXISTS (SELECT 1 FROM user_games g WHERE g.user_id = u.id)
        )
    `,
  );
  const members: CohortMember[] = memberRows.map((r) => ({
    userId: r.userId,
    createdAt: new Date(r.createdAt),
    signupSource: r.signupSource,
  }));

  const milestoneRows = await executeRows<{
    userId: string;
    key: string;
    reachedAt: string | Date;
  }>(
    db,
    sql`
      SELECT m.user_id AS "userId", m.key, m.reached_at AS "reachedAt"
      FROM user_milestones m
      JOIN users u ON u.id = m.user_id
      WHERE u.created_at >= ${since}::timestamptz
        AND m.key IN (${sql.join(
          DAY1_KEYS.map((k) => sql`${k}`),
          sql`, `,
        )})
    `,
  );
  const milestones = new Map<string, Map<string, Date>>();
  for (const r of milestoneRows) {
    const mine = milestones.get(r.userId) ?? new Map<string, Date>();
    mine.set(r.key, new Date(r.reachedAt));
    milestones.set(r.userId, mine);
  }
  return { members, milestones };
}

const TRIGGER_LABELS: Record<string, string> = {
  post_score: "After a score (pre-prompt)",
  poke: "Poke tap",
  settings: "Notifications screen",
};

/**
 * Distinct users per (trigger, stage) since `since`, from
 * `push_prompt_events`. Every known trigger gets a row, so an unused one reads
 * as zeros rather than vanishing.
 */
export async function loadPushFunnel(db: Db, since: Date): Promise<AdminPushFunnel> {
  const rows = await executeRows<{ trigger: string; stage: string; users: number | string }>(
    db,
    sql`
      SELECT trigger, stage, count(DISTINCT user_id) AS users
      FROM push_prompt_events
      WHERE created_at >= ${since.toISOString()}::timestamptz
      GROUP BY trigger, stage
    `,
  );
  const triggers = [
    ...PUSH_PROMPT_TRIGGERS,
    ...new Set(
      rows
        .map((r) => r.trigger)
        .filter((t) => !(PUSH_PROMPT_TRIGGERS as readonly string[]).includes(t)),
    ),
  ];
  const out: AdminPushFunnelRow[] = triggers.map((trigger) => {
    const stages: Partial<Record<PushPromptStage, number>> = {};
    for (const r of rows) {
      if (r.trigger === trigger && (PUSH_PROMPT_STAGES as readonly string[]).includes(r.stage)) {
        stages[r.stage as PushPromptStage] = Number(r.users);
      }
    }
    return { trigger, label: TRIGGER_LABELS[trigger] ?? trigger, stages };
  });
  return {
    label: "Push permission funnel",
    description:
      "Distinct users reaching each stage in the selected range, by what asked. Shown = our pre-prompt sheet appeared (post-score only; the poke and the Notifications switch ask directly). Accepted / declined = the answer to it, or the tap that asks. OS granted / denied = the iOS dialog's answer, counted only when that dialog actually appeared.",
    rows: out,
  };
}

/** `os_granted` distinct users per UTC day since `since` (the funnel's daily series). */
export async function pushGrantedByDay(
  db: Db,
  since: Date,
): Promise<{ userId: string; day: string }[]> {
  return executeRows<{ userId: string; day: string }>(
    db,
    sql`
      SELECT DISTINCT user_id AS "userId",
        to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day
      FROM push_prompt_events
      WHERE stage = 'os_granted' AND created_at >= ${since.toISOString()}::timestamptz
    `,
  );
}
