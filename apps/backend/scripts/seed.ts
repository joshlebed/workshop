/**
 * Seed dev data — populates the local Postgres with a "lived-in" set of lists,
 * items, members, and activity events so an agent or human running `pnpm dev`
 * (or the Niteshift sandbox setup script) lands on a non-empty UI.
 *
 * Tied to the web app's auto-dev-sign-in user (`joshlebed@gmail.com`).
 * Idempotent: if the seed user already owns lists, exits without touching the
 * database.
 *
 * Re-seed locally (activity_events.actor_id is NOT cascade, so clear events
 * and lists before users):
 *   docker exec workshop-pg psql -U postgres -d workshop -c "
 *     BEGIN;
 *     WITH t AS (SELECT id FROM users WHERE email LIKE '%@workshop.local' OR email = 'joshlebed@gmail.com')
 *     DELETE FROM activity_events WHERE actor_id IN (SELECT id FROM t);
 *     WITH t AS (SELECT id FROM users WHERE email LIKE '%@workshop.local' OR email = 'joshlebed@gmail.com')
 *     DELETE FROM lists WHERE owner_id IN (SELECT id FROM t);
 *     DELETE FROM users WHERE email LIKE '%@workshop.local' OR email = 'joshlebed@gmail.com';
 *     COMMIT;"
 *   pnpm --filter @workshop/backend run db:seed
 */

import type { ItemKind } from "@workshop/shared/itemKinds";
import type { ModuleName } from "@workshop/shared/modules";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import {
  activityEvents,
  friendRequests,
  friendships,
  gameScoreReactions,
  gameScores,
  itemAcceptances,
  items,
  itemTags,
  letterboxdWatchlistFilms,
  listMembers,
  listSavedViews,
  listSources,
  lists,
  userIdentities,
  users,
} from "../src/db/schema.js";
import { getConfig } from "../src/lib/config.js";
import { findOrCreateGame } from "../src/lib/gameCatalog.js";
import { generateShareSlug } from "../src/lib/shareSlug.js";
import { addToMyGames } from "../src/lib/userGames.js";

const PREVIEW_EMAIL = "joshlebed@gmail.com";
const PREVIEW_DISPLAY_NAME = "Josh";
const FRIEND_EMAIL = "friend@workshop.local";
const FRIEND_DISPLAY_NAME = "Alex";

async function ensureSeedUser(email: string, displayName: string) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(users).values({ email, displayName }).returning();
  if (!created) throw new Error(`[seed] failed to create user ${email}`);
  await db
    .insert(userIdentities)
    .values({ provider: "apple", providerSub: `dev:${email}`, userId: created.id })
    .onConflictDoNothing();
  return created;
}

async function main() {
  const cfg = getConfig();
  if (!cfg.isLocal) {
    console.log(`[seed] refusing to run: STAGE=${cfg.stage} (must be 'local')`);
    return;
  }

  const db = getDb();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${PREVIEW_EMAIL})`)
    .limit(1);

  if (existing) {
    const owned = await db
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.ownerId, existing.id))
      .limit(1);
    if (owned.length > 0) {
      console.log("[seed] preview user already has lists — skipping");
      return;
    }
  }

  console.log("[seed] inserting dev fixtures");

  const preview = await ensureSeedUser(PREVIEW_EMAIL, PREVIEW_DISPLAY_NAME);
  const friend = await ensureSeedUser(FRIEND_EMAIL, FRIEND_DISPLAY_NAME);
  const previewId = preview.id;
  const friendId = friend.id;

  type SeedItem = {
    title: string;
    url?: string;
    note?: string;
    content?: Record<string, unknown>;
    position?: number;
    completed?: boolean;
    /** Manual labels (spec §2.1) — lowercase; powers the filter-chip bar. */
    tags?: string[];
  };

  const fixtures: Array<{
    name: string;
    emoji: string;
    color: "sunset" | "ocean" | "forest" | "grape" | "rose" | "sand" | "slate";
    description?: string;
    sharedWithFriend?: boolean;
    itemKind: ItemKind;
    modules: ModuleName[];
    items: SeedItem[];
    /** Saved views (spec §2.3) — named, shared tag-filter presets on the list. */
    savedViews?: Array<{ name: string; tags: string[] }>;
  }> = [
    {
      name: "Movie Night",
      emoji: "🎬",
      color: "sunset",
      description: "Saturday picks before they leave the theatre.",
      sharedWithFriend: true,
      itemKind: "movie",
      modules: ["todo", "ranking"],
      items: [
        {
          title: "Dune: Part Two",
          position: 1024,
          content: {
            source: "tmdb",
            sourceId: "693134",
            posterUrl: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
            year: 2024,
            runtimeMinutes: 166,
            overview:
              "Paul Atreides unites with the Fremen to seek revenge against the conspirators.",
          },
        },
        {
          title: "Past Lives",
          position: 2048,
          content: {
            source: "tmdb",
            sourceId: "666277",
            posterUrl: "https://image.tmdb.org/t/p/w500/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg",
            year: 2023,
            runtimeMinutes: 106,
            overview: "Two deeply connected childhood friends reunite for one fateful week.",
          },
        },
        {
          title: "The Iron Claw",
          completed: true,
          content: {
            source: "tmdb",
            sourceId: "768362",
            posterUrl: "https://image.tmdb.org/t/p/w500/6OnoMgGFuZ921eV8v8yEyXoag19.jpg",
            year: 2023,
            runtimeMinutes: 132,
          },
        },
      ],
    },
    {
      name: "TV Queue",
      emoji: "📺",
      color: "ocean",
      itemKind: "tv",
      modules: ["todo", "ranking"],
      items: [
        {
          title: "Severance",
          position: 1024,
          content: {
            source: "tmdb",
            sourceId: "95396",
            posterUrl: "https://image.tmdb.org/t/p/w500/lFf6LLrQjYldcZItzOkGmMMigP7.jpg",
            year: 2022,
          },
        },
        {
          title: "The Bear",
          completed: true,
          content: {
            source: "tmdb",
            sourceId: "136315",
            posterUrl: "https://image.tmdb.org/t/p/w500/zPyHHRxKxiE4n2dz1lAjbqdkVNz.jpg",
            year: 2022,
          },
        },
      ],
    },
    {
      name: "Reading List",
      emoji: "📚",
      color: "forest",
      description: "On the nightstand.",
      itemKind: "book",
      modules: ["todo", "ranking"],
      items: [
        {
          title: "The Three-Body Problem",
          position: 1024,
          content: {
            source: "google_books",
            sourceId: "p9-yzwEACAAJ",
            coverUrl:
              "https://books.google.com/books/content?id=p9-yzwEACAAJ&printsec=frontcover&img=1&zoom=1",
            authors: ["Liu Cixin"],
            year: 2014,
            pageCount: 416,
          },
        },
        {
          title: "Project Hail Mary",
          position: 2048,
          content: {
            source: "google_books",
            sourceId: "lwTAEACAAJ",
            coverUrl:
              "https://books.google.com/books/content?id=lwTAEACAAJ&printsec=frontcover&img=1&zoom=1",
            authors: ["Andy Weir"],
            year: 2021,
            pageCount: 496,
          },
        },
        {
          title: "Tomorrow, and Tomorrow, and Tomorrow",
          content: {
            authors: ["Gabrielle Zevin"],
            year: 2022,
          },
        },
      ],
    },
    {
      name: "Date Ideas",
      emoji: "💜",
      color: "rose",
      sharedWithFriend: true,
      itemKind: "link",
      modules: ["todo", "ranking"],
      items: [
        {
          title: "Sunset hike at Twin Peaks",
          url: "https://sftravel.com/explore/twin-peaks",
          note: "Pack a jacket — wind picks up after 7pm.",
          position: 1024,
          content: { siteName: "sftravel.com" },
          tags: ["outdoors", "free"],
        },
        {
          title: "Tea at Smith",
          url: "https://www.smithtea.com/",
          position: 2048,
          content: { siteName: "Smith Teamaker" },
          tags: ["cozy"],
        },
      ],
      savedViews: [
        { name: "Outdoors", tags: ["outdoors"] },
        { name: "Cozy nights", tags: ["cozy"] },
      ],
    },
    {
      name: "Trip Bucket List",
      emoji: "✈️",
      color: "sand",
      itemKind: "link",
      modules: ["todo", "ranking"],
      items: [
        { title: "Tokyo cherry blossoms", note: "Late March / early April", position: 1024 },
        { title: "Lisbon weekend", note: "Stay in Alfama.", position: 2048 },
      ],
    },
    {
      name: "Ski gang games",
      emoji: "🎮",
      color: "slate",
      sharedWithFriend: true,
      itemKind: "link",
      modules: ["leaderboard", "ranking"],
      items: [
        {
          title: "maptap",
          url: "https://maptap.gg/",
          position: 512,
          content: { siteName: "maptap.gg" },
        },
        {
          title: "Globle",
          url: "https://globle-game.com/",
          position: 2048,
          content: {
            siteName: "Globle",
            thumbnailUrl: "https://globle-game.com/globle-preview.png",
          },
        },
        {
          title: "Satle",
          url: "https://satle.ca/",
          position: 3072,
          content: { siteName: "satle.ca" },
        },
        {
          title: "travle",
          url: "https://travle.earth",
          position: 4096,
          content: {
            siteName: "travle.earth",
            thumbnailUrl: "https://travle.earth/images/previews/countries_preview.png",
          },
        },
        {
          title: "Daily Tens",
          url: "https://dailytens.com/",
          position: 5120,
          content: { siteName: "dailytens.com" },
        },
        {
          title: "Tradle",
          url: "https://tradle.net/",
          position: 6144,
          content: { siteName: "tradle.net" },
        },
      ],
    },
  ];

  for (const fixture of fixtures) {
    const [list] = await db
      .insert(lists)
      .values({
        name: fixture.name,
        emoji: fixture.emoji,
        color: fixture.color,
        description: fixture.description ?? null,
        ownerId: previewId,
        itemKind: fixture.itemKind,
        modules: fixture.modules,
        shareSlug: generateShareSlug(),
      })
      .returning();
    if (!list) throw new Error(`[seed] failed to insert list ${fixture.name}`);

    await db.insert(listMembers).values({
      listId: list.id,
      userId: previewId,
      role: "owner",
    });

    if (fixture.sharedWithFriend) {
      await db.insert(listMembers).values({
        listId: list.id,
        userId: friendId,
        role: "member",
      });
      await db.insert(activityEvents).values({
        listId: list.id,
        actorId: friendId,
        eventType: "member_joined",
        payload: {},
      });
    }

    await db.insert(activityEvents).values({
      listId: list.id,
      actorId: previewId,
      eventType: "list_created",
      payload: {
        name: list.name,
        itemKind: fixture.itemKind,
        modules: fixture.modules,
      },
    });

    for (const seedItem of fixture.items) {
      const [item] = await db
        .insert(items)
        .values({
          listId: list.id,
          kind: fixture.itemKind,
          title: seedItem.title,
          url: seedItem.url ?? null,
          note: seedItem.note ?? null,
          content: seedItem.content ?? {},
          position: seedItem.position ?? null,
          addedBy: previewId,
          completed: seedItem.completed ?? false,
          completedAt: seedItem.completed ? new Date() : null,
          completedBy: seedItem.completed ? previewId : null,
        })
        .returning();
      if (!item) throw new Error(`[seed] failed to insert item ${seedItem.title}`);

      if (seedItem.tags && seedItem.tags.length > 0) {
        await db.insert(itemTags).values(seedItem.tags.map((tag) => ({ itemId: item.id, tag })));
      }

      await db.insert(activityEvents).values({
        listId: list.id,
        actorId: previewId,
        eventType: "item_added",
        itemId: item.id,
        payload: { title: item.title, kind: fixture.itemKind },
      });

      if (seedItem.completed) {
        await db.insert(activityEvents).values({
          listId: list.id,
          actorId: previewId,
          eventType: "item_completed",
          itemId: item.id,
          payload: { title: item.title },
        });
      }
    }

    if (fixture.savedViews && fixture.savedViews.length > 0) {
      await db.insert(listSavedViews).values(
        fixture.savedViews.map((v, i) => ({
          listId: list.id,
          name: v.name,
          config: { tags: v.tags },
          createdBy: previewId,
          position: i,
        })),
      );
    }
  }

  await seedLetterboxdMatch(previewId, friendId);
  await seedFriendGraph(previewId, friendId);

  console.log(`[seed] inserted ${fixtures.length + 1} lists for ${PREVIEW_EMAIL}`);
}

/**
 * A lived-in Letterboxd-match list: both seed users have a connected
 * Letterboxd username + cached watchlist (no live scrape — fixture rows),
 * two films overlap and exist as matched items, and one pending suggestion
 * from the friend awaits Josh's accept.
 */
async function seedLetterboxdMatch(previewId: string, friendId: string) {
  const db = getDb();

  await db
    .update(users)
    .set({ letterboxdUsername: "joshlebed", letterboxdSyncedAt: new Date() })
    .where(eq(users.id, previewId));
  await db
    .update(users)
    .set({ letterboxdUsername: "alexfilm", letterboxdSyncedAt: new Date() })
    .where(eq(users.id, friendId));

  const watchlists: Array<{ userId: string; films: Array<[string, string, number]> }> = [
    {
      userId: previewId,
      films: [
        ["aftersun", "Aftersun", 2022],
        ["the-zone-of-interest", "The Zone of Interest", 2023],
        ["perfect-days", "Perfect Days", 2023],
        ["la-chimera", "La Chimera", 2023],
      ],
    },
    {
      userId: friendId,
      films: [
        ["aftersun", "Aftersun", 2022],
        ["the-zone-of-interest", "The Zone of Interest", 2023],
        ["anatomy-of-a-fall", "Anatomy of a Fall", 2023],
      ],
    },
  ];
  for (const wl of watchlists) {
    await db
      .insert(letterboxdWatchlistFilms)
      .values(
        wl.films.map(([slug, title, year]) => ({ userId: wl.userId, filmSlug: slug, title, year })),
      )
      .onConflictDoNothing();
  }

  const [list] = await db
    .insert(lists)
    .values({
      name: "Movie Match",
      emoji: "🍿",
      color: "grape",
      description: "Films we both want to watch, straight from Letterboxd.",
      ownerId: previewId,
      itemKind: "movie",
      modules: ["ranking", "sources", "letterboxd"],
      shareSlug: generateShareSlug(),
    })
    .returning();
  if (!list) throw new Error("[seed] failed to insert letterboxd match list");

  await db.insert(listMembers).values([
    { listId: list.id, userId: previewId, role: "owner" as const },
    { listId: list.id, userId: friendId, role: "member" as const },
  ]);
  await db.insert(listSources).values({
    listId: list.id,
    kind: "letterboxd_match",
    config: {},
    lastSyncedAt: new Date(),
    lastSyncedBy: previewId,
  });

  const matched: Array<{ slug: string; title: string; year: number; position: number | null }> = [
    { slug: "aftersun", title: "Aftersun", year: 2022, position: 1024 },
    { slug: "the-zone-of-interest", title: "The Zone of Interest", year: 2023, position: null },
  ];
  for (const film of matched) {
    await db.insert(items).values({
      listId: list.id,
      kind: "movie",
      title: film.title,
      url: `https://letterboxd.com/film/${film.slug}/`,
      content: {
        source: "letterboxd",
        letterboxdUrl: `https://letterboxd.com/film/${film.slug}/`,
        letterboxdSlug: film.slug,
        year: film.year,
      },
      position: film.position,
      addedBy: previewId,
    });
  }

  // Pending suggestion from the friend — Josh sees the accept flow.
  const [suggestion] = await db
    .insert(items)
    .values({
      listId: list.id,
      kind: "movie",
      title: "Anatomy of a Fall",
      url: "https://letterboxd.com/film/anatomy-of-a-fall/",
      content: {
        source: "letterboxd",
        letterboxdUrl: "https://letterboxd.com/film/anatomy-of-a-fall/",
        letterboxdSlug: "anatomy-of-a-fall",
        year: 2023,
      },
      addedBy: friendId,
      suggestionState: "pending",
    })
    .returning();
  if (suggestion) {
    await db.insert(itemAcceptances).values({ itemId: suggestion.id, userId: friendId });
    await db.insert(activityEvents).values({
      listId: list.id,
      actorId: friendId,
      eventType: "item_suggested",
      itemId: suggestion.id,
      payload: { title: suggestion.title, letterboxdSlug: "anatomy-of-a-fall" },
    });
  }
}

/**
 * Friend graph for the social surfaces (requests / mutuals / profiles):
 * Josh ↔ Alex and Josh ↔ Casey are friends; Sam knows both (2 mutual
 * friends), Riley knows Alex (1), and Quinn (also 1) has a pending inbound
 * request to Josh so the Requests section + profile-menu badge render. Alex
 * gets two Games-tab games (Globle scored today, one Josh shares) so the
 * friend profile page has content.
 */
async function seedFriendGraph(previewId: string, friendId: string) {
  const db = getDb();
  const casey = await ensureSeedUser("casey@workshop.local", "Casey");
  const sam = await ensureSeedUser("sam@workshop.local", "Sam");
  const riley = await ensureSeedUser("riley@workshop.local", "Riley");
  const quinn = await ensureSeedUser("quinn@workshop.local", "Quinn");

  const edge = (a: string, b: string) =>
    a < b ? { userLow: a, userHigh: b } : { userLow: b, userHigh: a };
  await db
    .insert(friendships)
    .values([
      edge(previewId, friendId),
      edge(previewId, casey.id),
      edge(friendId, sam.id),
      edge(casey.id, sam.id),
      edge(friendId, riley.id),
      edge(friendId, quinn.id),
    ])
    .onConflictDoNothing();

  // Pending directed request: Quinn → Josh (token stays NULL — directed rows
  // never carry a share-link token).
  await db
    .insert(friendRequests)
    .values({ inviterId: quinn.id, inviteeId: previewId })
    .onConflictDoNothing();

  // Games for the profile page: Josh and Alex share Globle (Alex scored
  // today); Wordle is Alex-only so Josh sees the quick-add affordance.
  const globle = await findOrCreateGame("https://globle-game.com/", undefined, db);
  const wordle = await findOrCreateGame(
    "https://www.nytimes.com/games/wordle/index.html",
    undefined,
    db,
  );
  await addToMyGames(previewId, globle.id, db);
  await addToMyGames(friendId, globle.id, db);
  await addToMyGames(friendId, wordle.id, db);
  const todayKey = new Date().toISOString().slice(0, 10);
  const dayKey = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  // Josh has played Globle the last five days running, so the Games-home card
  // shows the "🔥 5" streak flame next to the title (a "play today" CTA).
  const joshStreakDays = [todayKey, dayKey(1), dayKey(2), dayKey(3), dayKey(4)];
  await db
    .insert(gameScores)
    .values([
      {
        gameId: globle.id,
        userId: friendId,
        periodKey: todayKey,
        scoreRaw: "🌎 Jun 11, 2026 🔥 2 | Avg. Guesses: 5\n🟨🟧🟥🟩 = 4\nhttps://globle-game.com",
        scoreValue: "4",
      },
      ...joshStreakDays.map((periodKey, i) => ({
        gameId: globle.id,
        userId: previewId,
        periodKey,
        scoreRaw: `🌎 Globle 🔥 ${joshStreakDays.length - i} | Avg. Guesses: 3\n🟨🟩 = ${2 + i}\nhttps://globle-game.com`,
        scoreValue: String(2 + i),
      })),
    ])
    .onConflictDoNothing();

  // Reactions both ways so the Games card shows a chip the viewer gave (on
  // Alex's row) and one they received (on their own row). Both are mutual-friend
  // reactions, so they pass the friend-graph visibility gate from either side.
  await db
    .insert(gameScoreReactions)
    .values([
      {
        gameId: globle.id,
        periodKey: todayKey,
        scoreUserId: friendId,
        reactorUserId: previewId,
        emoji: "🔥",
      },
      {
        gameId: globle.id,
        periodKey: todayKey,
        scoreUserId: previewId,
        reactorUserId: friendId,
        emoji: "🎉",
      },
    ])
    .onConflictDoNothing();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  });
