/**
 * Deterministic, privacy-safe HighScore fixtures for native App Store screenshots.
 *
 * This seed is deliberately separate from the everyday Workshop seed. It only
 * runs with STAGE=local and only replaces users under @highscore-demo.local,
 * so a Niteshift database cloned from production keeps real accounts untouched.
 */

import { readFile } from "node:fs/promises";
import { type GameKey, gameDefinitionForKey } from "@workshop/shared/gameRegistry";
import { eq, like } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import {
  friendships,
  gameScoreReactions,
  gameScores,
  userGames,
  userIdentities,
  users,
} from "../src/db/schema.js";
import { getConfig } from "../src/lib/config.js";
import { findOrCreateGame } from "../src/lib/gameCatalog.js";

const DEMO_DOMAIN = "highscore-demo.local";

const personas = [
  { key: "josh", email: `josh@${DEMO_DOMAIN}`, displayName: "Josh Lebedinsky" },
  {
    key: "andrew",
    email: `andrew@${DEMO_DOMAIN}`,
    displayName: "Andrew Cho",
    avatarFilename: "andrew-cho.jpg",
  },
  {
    key: "maddie",
    email: `maddie@${DEMO_DOMAIN}`,
    displayName: "Maddie Smith",
    avatarFilename: "maddie-smith.jpg",
  },
  {
    key: "francisco",
    email: `francisco@${DEMO_DOMAIN}`,
    displayName: "Francisco Silva",
    avatarFilename: "francisco-silva.jpg",
  },
  {
    key: "jackie",
    email: `jackie@${DEMO_DOMAIN}`,
    displayName: "Jackie Williams",
    avatarFilename: "jackie-williams.jpg",
  },
] as const;

type PersonaKey = (typeof personas)[number]["key"];

const scoreFixtures: Record<
  "maptap" | "travle" | "satle",
  Array<{ user: PersonaKey; value: number; raw: string; hoursAgo: number }>
> = {
  maptap: [
    {
      user: "josh",
      value: 937,
      raw: "www.maptap.gg August 28\n100🎯 90👑 90👑 89👑 100🎯\nFinal score: 937",
      hoursAgo: 5,
    },
    {
      user: "maddie",
      value: 916,
      raw: "www.maptap.gg August 28\n100🎯 95🏅 80✨ 94🏅 93🏆\nFinal score: 916",
      hoursAgo: 10,
    },
    {
      user: "jackie",
      value: 893,
      raw: "www.maptap.gg August 28\n100🎯 93🏆 92🏆 81🌟 91👑\nFinal score: 893",
      hoursAgo: 11,
    },
    {
      user: "francisco",
      value: 886,
      raw: "www.maptap.gg August 28\n100🎯 97🔥 79👏 91👑 86🎓\nFinal score: 886",
      hoursAgo: 11,
    },
    {
      user: "andrew",
      value: 839,
      raw: "www.maptap.gg August 28\n100🎯 89🎉 88🎉 78👏 80✨\nFinal score: 839",
      hoursAgo: 26,
    },
  ],
  travle: [
    {
      user: "jackie",
      value: 0,
      raw: "#travle #1353 +0 (Perfect)\n✅✅✅✅\nhttps://travle.earth",
      hoursAgo: 11,
    },
    {
      user: "andrew",
      value: 0,
      raw: "#travle #1353 +0\n🟩🟩🟩✅\nhttps://travle.earth",
      hoursAgo: 10,
    },
    {
      user: "josh",
      value: 0,
      raw: "#travle #1353 +0 (Perfect)\n✅✅✅✅\nhttps://travle.earth",
      hoursAgo: 5,
    },
    {
      user: "francisco",
      value: 1,
      raw: "#travle #1353 +1\n✅🟧✅🟩✅\nhttps://travle.earth",
      hoursAgo: 9,
    },
    {
      user: "maddie",
      value: 1,
      raw: "#travle #1353 +1\n✅✅✅🟧✅\nhttps://travle.earth",
      hoursAgo: 8,
    },
  ],
  satle: [
    {
      user: "josh",
      value: 2,
      raw: "🛰Satle #379 2/6\n🟥🟩⬜⬜⬜⬜\nhttps://satle.ca",
      hoursAgo: 3,
    },
    {
      user: "andrew",
      value: 3,
      raw: "🛰Satle #379 3/6\n🟥🟥🟩⬜⬜⬜\nhttps://satle.ca",
      hoursAgo: 5,
    },
    {
      user: "maddie",
      value: 3,
      raw: "🛰Satle #379 3/6\n🟥🟥🟩⬜⬜⬜\nhttps://satle.ca",
      hoursAgo: 7,
    },
    {
      user: "jackie",
      value: 4,
      raw: "🛰Satle #379 4/6\n🟥🟥🟥🟩⬜⬜\nhttps://satle.ca",
      hoursAgo: 9,
    },
  ],
};

async function avatarDataUrl(filename: string): Promise<string> {
  const bytes = await readFile(
    new URL(`./fixtures/highscore-appstore/avatars/${filename}`, import.meta.url),
  );
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

async function createPersona(
  persona: (typeof personas)[number],
  preservedJoshAvatar: string | null,
) {
  const db = getDb();
  const avatarFilename = "avatarFilename" in persona ? persona.avatarFilename : null;
  const [user] = await db
    .insert(users)
    .values({
      email: persona.email,
      displayName: persona.displayName,
      avatarUrl: avatarFilename ? await avatarDataUrl(avatarFilename) : preservedJoshAvatar,
    })
    .returning();
  if (!user) throw new Error(`failed to create ${persona.displayName}`);
  await db.insert(userIdentities).values({
    provider: "apple",
    providerSub: `dev:${persona.email}`,
    userId: user.id,
  });
  return user;
}

async function getCatalogGame(key: GameKey) {
  const definition = gameDefinitionForKey(key);
  if (!definition?.catalog) throw new Error(`missing catalog definition for ${key}`);
  return findOrCreateGame(definition.canonicalUrl);
}

function friendship(a: string, b: string) {
  return a < b ? { userLow: a, userHigh: b } : { userLow: b, userHigh: a };
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function dayKey(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  const cfg = getConfig();
  if (!cfg.isLocal) {
    throw new Error(`refusing App Store seed: STAGE=${cfg.stage} (must be local)`);
  }

  const db = getDb();
  const [existingJosh] = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.email, `josh@${DEMO_DOMAIN}`))
    .limit(1);
  await db.delete(users).where(like(users.email, `%@${DEMO_DOMAIN}`));

  const created = await Promise.all(
    personas.map((persona) => createPersona(persona, existingJosh?.avatarUrl ?? null)),
  );
  const people = Object.fromEntries(
    personas.map((persona, index) => [persona.key, created[index]!.id]),
  ) as Record<PersonaKey, string>;

  await db
    .insert(friendships)
    .values([
      friendship(people.josh, people.andrew),
      friendship(people.josh, people.maddie),
      friendship(people.josh, people.francisco),
      friendship(people.josh, people.jackie),
    ]);

  const catalog = {
    maptap: await getCatalogGame("maptap"),
    travle: await getCatalogGame("travle"),
    satle: await getCatalogGame("satle"),
    wordle: await getCatalogGame("wordle"),
    globle: await getCatalogGame("globle"),
  };

  const ownerGames = [catalog.maptap, catalog.travle, catalog.satle];
  await db.insert(userGames).values(
    ownerGames.map((game, index) => ({
      userId: people.josh,
      gameId: game.id,
      position: (index + 1) * 1024,
    })),
  );

  const scoringFriends: Array<Exclude<PersonaKey, "josh">> = [
    "andrew",
    "maddie",
    "francisco",
    "jackie",
  ];
  await db.insert(userGames).values(
    scoringFriends.flatMap((person, personIndex) => [
      ...ownerGames.map((game, gameIndex) => ({
        userId: people[person],
        gameId: game.id,
        position: (gameIndex + 1) * 1024,
      })),
      {
        userId: people[person],
        gameId: personIndex % 2 === 0 ? catalog.wordle.id : catalog.globle.id,
        position: 4096,
      },
    ]),
  );

  const today = dayKey(0);
  for (const key of ["maptap", "travle", "satle"] as const) {
    await db.insert(gameScores).values(
      scoreFixtures[key].map((fixture) => ({
        gameId: catalog[key].id,
        userId: people[fixture.user],
        periodKey: today,
        scoreValue: String(fixture.value),
        scoreRaw: fixture.raw,
        createdAt: hoursAgo(fixture.hoursAgo),
        updatedAt: hoursAgo(fixture.hoursAgo),
      })),
    );
  }

  await db.insert(gameScores).values(
    [1, 2, 3].map((daysAgo) => ({
      gameId: catalog.maptap.id,
      userId: people.josh,
      periodKey: dayKey(daysAgo),
      scoreValue: String(920 - daysAgo * 8),
      scoreRaw: `www.maptap.gg\n95🎯 90👑 88✨ 86🏆 80👏\nFinal score: ${920 - daysAgo * 8}`,
      createdAt: new Date(`${dayKey(daysAgo)}T15:00:00.000Z`),
      updatedAt: new Date(`${dayKey(daysAgo)}T15:00:00.000Z`),
    })),
  );

  await db.insert(gameScoreReactions).values([
    {
      gameId: catalog.maptap.id,
      periodKey: today,
      scoreUserId: people.josh,
      reactorUserId: people.maddie,
      emoji: "🎉",
    },
    {
      gameId: catalog.maptap.id,
      periodKey: today,
      scoreUserId: people.maddie,
      reactorUserId: people.josh,
      emoji: "🔥",
    },
    {
      gameId: catalog.travle.id,
      periodKey: today,
      scoreUserId: people.jackie,
      reactorUserId: people.josh,
      emoji: "👏",
    },
  ]);

  console.log(`seeded HighScore App Store fixtures for josh@${DEMO_DOMAIN}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("HighScore App Store seed failed", error);
    process.exit(1);
  });
