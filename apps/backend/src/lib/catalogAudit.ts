// Catalog ops audit — the read-only report behind the daily `catalog-audit`
// Niteshift automation (docs/catalog-ops-runbook.md). Three questions:
//
//   1. Candidates: which games have at least one player but aren't in the
//      official catalog (`isOfficiallyListed`)? Each comes with a suggested
//      game type and a content flag so the operator's review is a yes/no
//      plus a category, not research. The automation turns these into a PR
//      against `OFFICIAL_CATALOG_EXTRAS`; a human merges — never this code.
//   2. Health of what's listed: parsers (stored code, 30-day unread rate,
//      open pick conflicts) and formatters (stored code), so a listed game
//      that reads scores badly gets fixed instead of quietly ranking nobody.
//   3. Stale extras: listed URLs with no `games` row at all (a typo, or a
//      row that was merged away) — dead entries to prune.
//
// Pure SQL reads via drizzle; the script wrapper opens the session read-only.

import {
  GAME_CATEGORIES,
  type GameCategory,
  gameCategoryFor,
  gameDefinitionForKey,
  isOfficiallyListed,
  OFFICIAL_CATALOG_EXTRAS,
} from "@workshop/shared/gameRegistry";
import { asc, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { gameScores, games, userGames } from "../db/schema.js";
import { containsObjectionableContent } from "./contentFilter.js";
import { toIsoString } from "./dates.js";

const AUDIT_WINDOW_DAYS = 30;
/** A listed game whose last-30-day scores read worse than this is flagged. */
const UNREAD_RATE_THRESHOLD = 0.2;

interface CatalogCandidate {
  gameId: string;
  title: string;
  url: string;
  normalizedUrl: string;
  playerCount: number;
  /** Scores posted in the window — demand, not just "someone added it". */
  scoresInWindow: number;
  hasParser: boolean;
  hasFormatter: boolean;
  suggestedCategory: GameCategory;
  /**
   * `objectionable-title`: the title/url trips the content filter — do not
   * list; consider `admin:eject`. `no-parser`: scores for it are unread until
   * someone teaches it. `single-player`: only one person has it.
   */
  flags: string[];
}

interface ListedGameHealth {
  gameId: string;
  title: string;
  gameKey: string | null;
  category: GameCategory;
  playerCount: number;
  scoresInWindow: number;
  unreadInWindow: number;
  hasParser: boolean;
  hasFormatter: boolean;
  parseConflictAt: string | null;
  /** Empty = healthy. Only unhealthy games are reported. */
  issues: string[];
}

interface CatalogAuditReport {
  generatedAt: string;
  windowDays: number;
  totals: {
    gamesWithPlayers: number;
    listed: number;
    candidates: number;
    unhealthyListed: number;
    staleExtras: number;
  };
  candidates: CatalogCandidate[];
  unhealthy: ListedGameHealth[];
  staleExtras: { normalizedUrl: string; title: string }[];
}

// Checked in order: a specific signal ("heard", "globe") beats the loose
// "…dle" word-game catch-all at the end.
const CATEGORY_HINTS: { category: GameCategory; pattern: RegExp }[] = [
  {
    category: "music-movies",
    pattern: /music|song|heard|movie|film|frame|actor|cinema|album|band|\btv\b|show/i,
  },
  {
    category: "geography",
    pattern: /geo|glob|world|map|countr|capital|flag|travel|cit(?:y|ies)|earth|where|atlas/i,
  },
  {
    category: "puzzles",
    pattern: /sudoku|number|math|logic|puzzle|mini|chess|nerdle|digit|grid/i,
  },
  { category: "trivia", pattern: /trivia|quiz|guess|fact|histor|\bwho\b|\bwhat\b|tens/i },
  {
    category: "words",
    pattern: /word|letter|spell|anagram|cross|vocab|lexi|dle\b|square/i,
  },
];

/** Keyword guess at a candidate's game type — a starting point for the operator, never authoritative. */
export function suggestCategory(title: string, url: string): GameCategory {
  const haystack = `${title} ${url}`;
  for (const { category, pattern } of CATEGORY_HINTS) {
    if (pattern.test(haystack)) return category;
  }
  return "other";
}

export async function runCatalogAudit(now: Date = new Date()): Promise<CatalogAuditReport> {
  const db = getDb();
  const since = new Date(now.getTime() - AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const players = db
    .select({ gameId: userGames.gameId, n: sql<number>`count(*)::int`.as("players_n") })
    .from(userGames)
    .groupBy(userGames.gameId)
    .as("players");
  const scores = db
    .select({
      gameId: gameScores.gameId,
      total: sql<number>`count(*)::int`.as("scores_total"),
      unread: sql<number>`count(*) filter (where ${gameScores.parseStatus} = 'failed')::int`.as(
        "scores_unread",
      ),
    })
    .from(gameScores)
    .where(gte(gameScores.updatedAt, since))
    .groupBy(gameScores.gameId)
    .as("scores");

  const rows = await db
    .select({
      game: games,
      playerCount: sql<number>`coalesce(${players.n}, 0)`,
      scoresInWindow: sql<number>`coalesce(${scores.total}, 0)`,
      unreadInWindow: sql<number>`coalesce(${scores.unread}, 0)`,
    })
    .from(games)
    .leftJoin(players, eq(players.gameId, games.id))
    .leftJoin(scores, eq(scores.gameId, games.id))
    .orderBy(desc(sql`coalesce(${players.n}, 0)`), asc(games.title));

  const candidates: CatalogCandidate[] = [];
  const unhealthy: ListedGameHealth[] = [];
  let gamesWithPlayers = 0;
  let listed = 0;
  const seenUrls = new Set<string>();

  for (const r of rows) {
    const g = r.game;
    seenUrls.add(g.normalizedUrl);
    const hasParser = g.parseCode !== null;
    const hasFormatter = g.formatCode !== null;
    if (r.playerCount > 0) gamesWithPlayers += 1;

    if (!isOfficiallyListed(g)) {
      if (r.playerCount === 0) continue;
      const flags: string[] = [];
      if (containsObjectionableContent(`${g.title} ${g.url}`)) flags.push("objectionable-title");
      if (!hasParser) flags.push("no-parser");
      if (r.playerCount === 1) flags.push("single-player");
      candidates.push({
        gameId: g.id,
        title: g.title,
        url: g.url,
        normalizedUrl: g.normalizedUrl,
        playerCount: r.playerCount,
        scoresInWindow: r.scoresInWindow,
        hasParser,
        hasFormatter,
        suggestedCategory: suggestCategory(g.title, g.url),
        flags,
      });
      continue;
    }

    listed += 1;
    const issues: string[] = [];
    // Registry games parse via code seeded from the registry; a listed extra
    // only parses once someone taught it.
    if (!hasParser) issues.push("no parser: every score is stored unread");
    if (!hasFormatter) issues.push("no formatter: rows show raw share text");
    if (g.parseConflictAt) issues.push("open parse conflict (two players' picks disagree)");
    if (r.scoresInWindow >= 5 && r.unreadInWindow / r.scoresInWindow > UNREAD_RATE_THRESHOLD) {
      issues.push(
        `${r.unreadInWindow}/${r.scoresInWindow} scores unread in the last ${AUDIT_WINDOW_DAYS} days`,
      );
    }
    if (issues.length === 0) continue;
    unhealthy.push({
      gameId: g.id,
      title: g.title,
      gameKey: g.gameKey,
      category: gameCategoryFor(g),
      playerCount: r.playerCount,
      scoresInWindow: r.scoresInWindow,
      unreadInWindow: r.unreadInWindow,
      hasParser,
      hasFormatter,
      parseConflictAt: g.parseConflictAt ? toIsoString(g.parseConflictAt) : null,
      issues,
    });
  }

  const staleExtras = OFFICIAL_CATALOG_EXTRAS.filter((e) => !seenUrls.has(e.normalizedUrl)).map(
    (e) => ({ normalizedUrl: e.normalizedUrl, title: e.title }),
  );

  return {
    generatedAt: now.toISOString(),
    windowDays: AUDIT_WINDOW_DAYS,
    totals: {
      gamesWithPlayers,
      listed,
      candidates: candidates.length,
      unhealthyListed: unhealthy.length,
      staleExtras: staleExtras.length,
    },
    candidates,
    unhealthy,
    staleExtras,
  };
}

function categoryLabel(category: GameCategory): string {
  return GAME_CATEGORIES.find((c) => c.key === category)?.label ?? category;
}

/** The report as the markdown the automation pastes into its PR / summary. */
export function renderCatalogAuditMarkdown(report: CatalogAuditReport): string {
  const out: string[] = [];
  out.push(`# Catalog audit — ${report.generatedAt.slice(0, 10)}`);
  out.push("");
  out.push(
    `${report.totals.gamesWithPlayers} games have players · ${report.totals.listed} listed · ` +
      `${report.totals.candidates} candidates · ${report.totals.unhealthyListed} listed games need attention · ` +
      `${report.totals.staleExtras} stale extras`,
  );
  out.push("");

  out.push("## Candidates (players, not listed)");
  if (report.candidates.length === 0) out.push("_None._");
  else {
    out.push("| Game | URL | Players | Scores (30d) | Parser | Suggested type | Flags |");
    out.push("| --- | --- | ---: | ---: | --- | --- | --- |");
    for (const c of report.candidates) {
      out.push(
        `| ${c.title} | ${c.url} | ${c.playerCount} | ${c.scoresInWindow} | ${c.hasParser ? "yes" : "no"} | ${categoryLabel(c.suggestedCategory)} | ${c.flags.join(", ") || "—"} |`,
      );
    }
    out.push("");
    out.push(
      "Proposed `OFFICIAL_CATALOG_EXTRAS` entries (review the category; drop anything flagged `objectionable-title`):",
    );
    out.push("");
    out.push("```ts");
    for (const c of report.candidates.filter((c) => !c.flags.includes("objectionable-title"))) {
      out.push(
        `{ normalizedUrl: ${JSON.stringify(c.normalizedUrl)}, title: ${JSON.stringify(c.title)}, category: ${JSON.stringify(c.suggestedCategory)} },`,
      );
    }
    out.push("```");
  }
  out.push("");

  out.push("## Listed games needing attention");
  if (report.unhealthy.length === 0)
    out.push(
      "_All listed games have a parser and a formatter, no open conflicts, and read their recent scores._",
    );
  else {
    for (const h of report.unhealthy) {
      out.push(
        `- **${h.title}** (${h.gameKey ?? "extra"}, ${h.playerCount} players, ${h.scoresInWindow} scores/30d): ${h.issues.join("; ")}`,
      );
    }
  }
  out.push("");

  out.push("## Stale extras (listed, no games row)");
  if (report.staleExtras.length === 0) out.push("_None._");
  else for (const e of report.staleExtras) out.push(`- ${e.title} — \`${e.normalizedUrl}\``);
  out.push("");

  const registryGap = report.unhealthy.filter((h) => h.gameKey && !gameDefinitionForKey(h.gameKey));
  if (registryGap.length > 0) {
    out.push("## Rows with a game_key the registry no longer knows");
    for (const h of registryGap) out.push(`- ${h.title} (${h.gameKey})`);
    out.push("");
  }
  return out.join("\n");
}
