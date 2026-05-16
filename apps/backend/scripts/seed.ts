/**
 * Seed dev data — populates the local Postgres with a "lived-in" set of lists,
 * items, members, upvotes, and activity events so an agent or human running
 * `pnpm dev` (or the Niteshift sandbox setup script) lands on a non-empty UI.
 *
 * Tied to the web app's auto-dev-sign-in user (`preview@workshop.local`, see
 * `apps/workshop/src/hooks/useAuth.tsx`) so anyone who hits the preview with
 * `EXPO_PUBLIC_DEV_AUTH=1` immediately sees this content.
 *
 * Idempotent: if the seed user already owns lists, exits without touching the
 * database. Refusing to mutate in non-local stages is a hard guard — never run
 * this against prod.
 *
 * Re-seed locally with:
 *   docker exec workshop-pg psql -U postgres -d workshop \
 *     -c "DELETE FROM users WHERE email LIKE '%@workshop.local';"
 *   pnpm --filter @workshop/backend run db:seed
 */
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import {
  activityEvents,
  gameScores,
  items,
  itemUpvotes,
  listMembers,
  lists,
  users,
} from "../src/db/schema.js";
import { getConfig } from "../src/lib/config.js";

const PREVIEW_EMAIL = "preview@workshop.local";
const FRIEND_EMAIL = "friend@workshop.local";

async function main() {
  const cfg = getConfig();
  if (!cfg.isLocal) {
    console.log(`[seed] refusing to run: STAGE=${cfg.stage} (must be 'local')`);
    return;
  }

  const db = getDb();

  // Idempotency check: if the preview user already owns lists, bail.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, PREVIEW_EMAIL))
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

  const [preview] = await db
    .insert(users)
    .values({
      authProvider: "google",
      providerSub: `dev:${PREVIEW_EMAIL}`,
      email: PREVIEW_EMAIL,
      displayName: "Preview User",
    })
    .onConflictDoUpdate({
      target: [users.authProvider, users.providerSub],
      set: { email: PREVIEW_EMAIL, displayName: "Preview User" },
    })
    .returning();

  const [friend] = await db
    .insert(users)
    .values({
      authProvider: "google",
      providerSub: `dev:${FRIEND_EMAIL}`,
      email: FRIEND_EMAIL,
      displayName: "Alex",
    })
    .onConflictDoUpdate({
      target: [users.authProvider, users.providerSub],
      set: { email: FRIEND_EMAIL, displayName: "Alex" },
    })
    .returning();

  if (!preview || !friend) throw new Error("[seed] failed to upsert seed users");

  const previewId = preview.id;
  const friendId = friend.id;

  // ---------------------------------------------------------------------------
  // Lists & items
  // ---------------------------------------------------------------------------
  // Use bare TMDB / OG image hosts so thumbnails render in the web preview
  // without any provider-API roundtrip. Positions are spaced by 1024 so
  // mid-point reorders (the client pattern) work without re-numbering.
  // ---------------------------------------------------------------------------

  type SeedItem = {
    title: string;
    url?: string;
    note?: string;
    metadata?: Record<string, unknown>;
    completed?: boolean;
  };

  const fixtures: Array<{
    type: "movie" | "tv" | "book" | "date_idea" | "trip" | "game";
    name: string;
    emoji: string;
    color: "sunset" | "ocean" | "forest" | "grape" | "rose" | "sand" | "slate";
    description?: string;
    sharedWithFriend?: boolean;
    items: SeedItem[];
  }> = [
    {
      type: "movie",
      name: "Movie Night",
      emoji: "🎬",
      color: "sunset",
      description: "Saturday picks before they leave the theatre.",
      sharedWithFriend: true,
      items: [
        {
          title: "Dune: Part Two",
          metadata: {
            source: "tmdb",
            sourceId: "693134",
            posterUrl: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
            year: 2024,
            runtimeMinutes: 166,
            overview:
              "Paul Atreides unites with the Fremen to seek revenge against the conspirators.",
            position: 1024,
          },
        },
        {
          title: "Past Lives",
          metadata: {
            source: "tmdb",
            sourceId: "666277",
            posterUrl: "https://image.tmdb.org/t/p/w500/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg",
            year: 2023,
            runtimeMinutes: 106,
            overview: "Two deeply connected childhood friends reunite for one fateful week.",
            position: 2048,
          },
        },
        {
          title: "The Iron Claw",
          completed: true,
          metadata: {
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
      type: "tv",
      name: "TV Queue",
      emoji: "📺",
      color: "ocean",
      items: [
        {
          title: "Severance",
          metadata: {
            source: "tmdb",
            sourceId: "95396",
            posterUrl: "https://image.tmdb.org/t/p/w500/lFf6LLrQjYldcZItzOkGmMMigP7.jpg",
            year: 2022,
            overview:
              "Mark leads a team of office workers whose memories have been surgically divided.",
            position: 1024,
          },
        },
        {
          title: "The Bear",
          completed: true,
          metadata: {
            source: "tmdb",
            sourceId: "136315",
            posterUrl: "https://image.tmdb.org/t/p/w500/zPyHHRxKxiE4n2dz1lAjbqdkVNz.jpg",
            year: 2022,
          },
        },
      ],
    },
    {
      type: "book",
      name: "Reading List",
      emoji: "📚",
      color: "forest",
      description: "On the nightstand.",
      items: [
        {
          title: "The Three-Body Problem",
          metadata: {
            source: "google_books",
            sourceId: "p9-yzwEACAAJ",
            coverUrl:
              "https://books.google.com/books/content?id=p9-yzwEACAAJ&printsec=frontcover&img=1&zoom=1",
            authors: ["Liu Cixin"],
            year: 2014,
            pageCount: 416,
            position: 1024,
          },
        },
        {
          title: "Project Hail Mary",
          metadata: {
            source: "google_books",
            sourceId: "lwTAEACAAJ",
            coverUrl:
              "https://books.google.com/books/content?id=lwTAEACAAJ&printsec=frontcover&img=1&zoom=1",
            authors: ["Andy Weir"],
            year: 2021,
            pageCount: 496,
            position: 2048,
          },
        },
        {
          title: "Tomorrow, and Tomorrow, and Tomorrow",
          metadata: {
            authors: ["Gabrielle Zevin"],
            year: 2022,
          },
        },
      ],
    },
    {
      type: "date_idea",
      name: "Date Ideas",
      emoji: "💜",
      color: "rose",
      sharedWithFriend: true,
      items: [
        {
          title: "Sunset hike at Twin Peaks",
          url: "https://sftravel.com/explore/twin-peaks",
          note: "Pack a jacket — wind picks up after 7pm.",
          metadata: {
            siteName: "sftravel.com",
            position: 1024,
          },
        },
        {
          title: "Tea at Smith",
          url: "https://www.smithtea.com/",
          metadata: {
            siteName: "Smith Teamaker",
            position: 2048,
          },
        },
      ],
    },
    {
      type: "trip",
      name: "Trip Bucket List",
      emoji: "✈️",
      color: "slate",
      items: [
        {
          title: "Tokyo cherry blossoms",
          note: "Late March / early April",
          metadata: { position: 1024 },
        },
        {
          title: "Lisbon weekend",
          note: "Stay in Alfama.",
          metadata: { position: 2048 },
        },
      ],
    },
    {
      type: "game",
      name: "Ski gang games",
      emoji: "🎮",
      color: "ocean",
      sharedWithFriend: true,
      items: [
        {
          title: "maptap",
          url: "https://maptap.gg/",
          metadata: {
            siteName: "maptap.gg",
            position: 512,
          },
        },
        {
          title: "Globle",
          url: "https://globle-game.com/",
          metadata: {
            siteName: "Globle",
            thumbnailUrl: "https://globle-game.com/globle-preview.png",
            position: 2048,
          },
        },
        {
          title: "Satle",
          url: "https://satle.ca/",
          metadata: {
            siteName: "satle.ca",
            position: 3072,
          },
        },
        {
          title: "travle",
          url: "https://travle.earth",
          metadata: {
            siteName: "travle.earth",
            thumbnailUrl: "https://travle.earth/images/previews/countries_preview.png",
            position: 4096,
          },
        },
        {
          title: "Daily Tens",
          url: "https://dailytens.com/",
          metadata: {
            siteName: "dailytens.com",
            position: 5120,
          },
        },
      ],
    },
  ];

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  for (const fixture of fixtures) {
    const [list] = await db
      .insert(lists)
      .values({
        type: fixture.type,
        name: fixture.name,
        emoji: fixture.emoji,
        color: fixture.color,
        description: fixture.description ?? null,
        ownerId: previewId,
        metadata: {},
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
      payload: { name: list.name, type: list.type },
    });

    for (const seedItem of fixture.items) {
      const [item] = await db
        .insert(items)
        .values({
          listId: list.id,
          type: fixture.type,
          title: seedItem.title,
          url: seedItem.url ?? null,
          note: seedItem.note ?? null,
          metadata: seedItem.metadata ?? {},
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
        payload: { title: item.title, type: item.type },
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

      // Friend upvotes one item per shared list to exercise the upvote UI.
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

      // A couple of recent scores per known game so the game-detail view has
      // something to render. Skip games we don't have plausible share text for.
      if (fixture.type === "game") {
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
          await db.insert(gameScores).values([
            { itemId: item.id, userId: previewId, date: today, score: scores.today },
            { itemId: item.id, userId: previewId, date: yesterday, score: scores.yesterday },
            { itemId: item.id, userId: friendId, date: today, score: scores.today },
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
