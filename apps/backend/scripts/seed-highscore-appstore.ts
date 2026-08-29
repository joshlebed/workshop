/**
 * Deterministic, privacy-safe HighScore fixtures for native App Store screenshots.
 *
 * This seed is deliberately separate from the everyday Workshop seed. It only
 * runs with STAGE=local and only replaces users under @highscore-demo.local,
 * so a Niteshift database cloned from production keeps real accounts untouched.
 */

import { type GameKey, gameDefinitionForKey } from "@workshop/shared/gameRegistry";
import { like } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import {
  friendRequests,
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
  { key: "maya", email: `maya@${DEMO_DOMAIN}`, displayName: "Maya Chen" },
  { key: "theo", email: `theo@${DEMO_DOMAIN}`, displayName: "Theo Brooks" },
  { key: "nina", email: `nina@${DEMO_DOMAIN}`, displayName: "Nina Patel" },
  { key: "omar", email: `omar@${DEMO_DOMAIN}`, displayName: "Omar Reyes" },
  { key: "june", email: `june@${DEMO_DOMAIN}`, displayName: "June Park" },
  { key: "avery", email: `avery@${DEMO_DOMAIN}`, displayName: "Avery Stone" },
] as const;

type PersonaKey = (typeof personas)[number]["key"];

const scoreFixtures: Record<
  "maptap" | "travle" | "satle",
  Array<{ user: Exclude<PersonaKey, "avery">; value: number; raw: string; hoursAgo: number }>
> = {
  maptap: [
    {
      user: "maya",
      value: 937,
      raw: "www.maptap.gg\n100🎯 90👑 90👑 89👑 100🎯\nFinal score: 937",
      hoursAgo: 5,
    },
    {
      user: "theo",
      value: 916,
      raw: "www.maptap.gg\n100🎯 95🥇 80✨ 94🥈 93🏆\nFinal score: 916",
      hoursAgo: 8,
    },
    {
      user: "nina",
      value: 893,
      raw: "www.maptap.gg\n100🎯 93🏆 92🏆 81🌟 91👑\nFinal score: 893",
      hoursAgo: 9,
    },
    {
      user: "omar",
      value: 886,
      raw: "www.maptap.gg\n100🎯 97🔥 79👏 91👑 86🎓\nFinal score: 886",
      hoursAgo: 10,
    },
    {
      user: "june",
      value: 839,
      raw: "www.maptap.gg\n100🎯 89🎉 88🎉 78👏 80✨\nFinal score: 839",
      hoursAgo: 12,
    },
  ],
  travle: [
    {
      user: "maya",
      value: 0,
      raw: "#travle #1260 +0 (Perfect)\n✅✅✅✅\nhttps://travle.earth",
      hoursAgo: 4,
    },
    {
      user: "theo",
      value: 0,
      raw: "#travle #1260 +0\n🟩🟩🟩✅\nhttps://travle.earth",
      hoursAgo: 6,
    },
    {
      user: "nina",
      value: 0,
      raw: "#travle #1260 +0 (Perfect)\n✅✅✅✅\nhttps://travle.earth",
      hoursAgo: 7,
    },
    {
      user: "omar",
      value: 1,
      raw: "#travle #1260 +1\n✅🟧✅🟩✅\nhttps://travle.earth",
      hoursAgo: 8,
    },
    {
      user: "june",
      value: 1,
      raw: "#travle #1260 +1\n✅✅✅🟧✅\nhttps://travle.earth",
      hoursAgo: 11,
    },
  ],
  satle: [
    {
      user: "maya",
      value: 2,
      raw: "🛰 Satle #472 2/6\n🟥🟩⬜⬜⬜⬜\nhttps://satle.ca",
      hoursAgo: 3,
    },
    {
      user: "theo",
      value: 3,
      raw: "🛰 Satle #472 3/6\n🟥🟥🟩⬜⬜⬜\nhttps://satle.ca",
      hoursAgo: 5,
    },
    {
      user: "nina",
      value: 3,
      raw: "🛰 Satle #472 3/6\n🟥🟥🟩⬜⬜⬜\nhttps://satle.ca",
      hoursAgo: 7,
    },
    {
      user: "omar",
      value: 4,
      raw: "🛰 Satle #472 4/6\n🟥🟥🟥🟩⬜⬜\nhttps://satle.ca",
      hoursAgo: 9,
    },
    {
      user: "june",
      value: 5,
      raw: "🛰 Satle #472 5/6\n🟥🟥🟥🟥🟩⬜\nhttps://satle.ca",
      hoursAgo: 13,
    },
  ],
};

async function createPersona(persona: (typeof personas)[number]) {
  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({ email: persona.email, displayName: persona.displayName })
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
  await db.delete(users).where(like(users.email, `%@${DEMO_DOMAIN}`));

  const created = await Promise.all(personas.map(createPersona));
  const people = Object.fromEntries(
    personas.map((persona, index) => [persona.key, created[index]!.id]),
  ) as Record<PersonaKey, string>;

  await db
    .insert(friendships)
    .values([
      friendship(people.maya, people.theo),
      friendship(people.maya, people.nina),
      friendship(people.maya, people.omar),
      friendship(people.maya, people.june),
      friendship(people.theo, people.avery),
      friendship(people.nina, people.avery),
    ]);
  await db.insert(friendRequests).values({
    inviterId: people.avery,
    inviteeId: people.maya,
  });

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
      userId: people.maya,
      gameId: game.id,
      position: (index + 1) * 1024,
    })),
  );

  const scoringFriends: Array<Exclude<PersonaKey, "maya" | "avery">> = [
    "theo",
    "nina",
    "omar",
    "june",
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
      userId: people.maya,
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
      scoreUserId: people.maya,
      reactorUserId: people.nina,
      emoji: "🎉",
    },
    {
      gameId: catalog.maptap.id,
      periodKey: today,
      scoreUserId: people.theo,
      reactorUserId: people.maya,
      emoji: "🔥",
    },
    {
      gameId: catalog.travle.id,
      periodKey: today,
      scoreUserId: people.nina,
      reactorUserId: people.maya,
      emoji: "👏",
    },
  ]);

  console.log(`seeded HighScore App Store fixtures for maya@${DEMO_DOMAIN}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("HighScore App Store seed failed", error);
    process.exit(1);
  });
