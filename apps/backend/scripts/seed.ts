/**
 * Seed dev data — populates the local Postgres with a "lived-in" set of lists,
 * items, members, upvotes, and activity events so an agent or human running
 * `pnpm dev` (or the Niteshift sandbox setup script) lands on a non-empty UI.
 *
 * Tied to the web app's auto-dev-sign-in user (`joshlebed@gmail.com`).
 * Idempotent: if the seed user already owns lists, exits without touching the
 * database.
 *
 * Re-seed locally with:
 *   docker exec workshop-pg psql -U postgres -d workshop \
 *     -c "DELETE FROM users WHERE email IN ('joshlebed@gmail.com','friend@workshop.local');"
 *   pnpm --filter @workshop/backend run db:seed
 */

import type { ItemKind } from "@workshop/shared/itemKinds";
import type { ModuleName } from "@workshop/shared/modules";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import {
  activityEvents,
  itemScores,
  items,
  itemUpvotes,
  listMembers,
  lists,
  userIdentities,
  users,
} from "../src/db/schema.js";
import { getConfig } from "../src/lib/config.js";

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
  }> = [
    {
      name: "Movie Night",
      emoji: "🎬",
      color: "sunset",
      description: "Saturday picks before they leave the theatre.",
      sharedWithFriend: true,
      itemKind: "movie",
      modules: ["voting", "todo", "ranking"],
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
      modules: ["voting", "todo", "ranking"],
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
      modules: ["voting", "todo", "ranking"],
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
      modules: ["voting", "todo", "ranking"],
      items: [
        {
          title: "Sunset hike at Twin Peaks",
          url: "https://sftravel.com/explore/twin-peaks",
          note: "Pack a jacket — wind picks up after 7pm.",
          position: 1024,
          content: { siteName: "sftravel.com" },
        },
        {
          title: "Tea at Smith",
          url: "https://www.smithtea.com/",
          position: 2048,
          content: { siteName: "Smith Teamaker" },
        },
      ],
    },
    {
      name: "Trip Bucket List",
      emoji: "✈️",
      color: "sand",
      itemKind: "link",
      modules: ["voting", "todo", "ranking"],
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
      modules: ["voting", "leaderboard", "ranking"],
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
      ],
    },
    {
      name: "Quick Poll",
      emoji: "🗳️",
      color: "grape",
      description: "Best post-dinner activity for Saturday?",
      sharedWithFriend: true,
      itemKind: "plain",
      modules: ["voting"],
      items: [
        { title: "Movie night" },
        { title: "Game night" },
        { title: "Walk to the dessert place" },
      ],
    },
  ];

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

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

      if (fixture.sharedWithFriend && fixture.items.indexOf(seedItem) === 0) {
        await db.insert(itemUpvotes).values({
          itemId: item.id,
          userId: friendId,
        });
        await db.insert(activityEvents).values({
          listId: list.id,
          actorId: friendId,
          eventType: "item_upvoted",
          itemId: item.id,
          payload: { title: item.title },
        });
      }

      if (fixture.modules.includes("leaderboard")) {
        const sharedScores: Record<string, { today: string; yesterday: string }> = {
          Globle: {
            today: "🌎 May 15, 2026 🔥 1 | Avg. Guesses: 4\n🟨🟧🟥🟩\nhttps://globle-game.com",
            yesterday:
              "🌎 May 14, 2026 🔥 0 | Avg. Guesses: 6\n🟨🟨🟧🟧🟥🟩\nhttps://globle-game.com",
          },
          travle: {
            today: "#travle #1066 +0 (100%)\n✅✅✅✅✅\nhttps://travle.earth",
            yesterday: "#travle #1065 +1 (83%)\n✅✅🟧✅✅✅\nhttps://travle.earth",
          },
        };
        const scores = sharedScores[seedItem.title];
        if (scores) {
          await db.insert(itemScores).values([
            {
              itemId: item.id,
              userId: previewId,
              periodKey: today,
              scoreRaw: scores.today,
              scoreValue: null,
            },
            {
              itemId: item.id,
              userId: previewId,
              periodKey: yesterday,
              scoreRaw: scores.yesterday,
              scoreValue: null,
            },
            {
              itemId: item.id,
              userId: friendId,
              periodKey: today,
              scoreRaw: scores.today,
              scoreValue: null,
            },
          ]);
        }
      }
    }
  }

  console.log(`[seed] inserted ${fixtures.length} lists for ${PREVIEW_EMAIL}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  });
