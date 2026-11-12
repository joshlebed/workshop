import {
  api,
  cleanupScratchUser,
  createScratchList,
  expect,
  mintScratchUser,
  type ScratchUser,
  seedSession,
  test,
} from "./helpers";

// List settings offers only the features a list's kind supports, in that
// list's words (`@workshop/shared/listKinds`, docs/list-types.md). One list
// per kind; the album shelf has no playlist attached, so it shows the
// Connect form (the sandbox can't rely on reaching Spotify).

test.use({ viewport: { width: 390, height: 844 } });

interface Case {
  name: string;
  itemKind: string | null;
  modules: string[];
  holds: string;
  switches: string[];
  syncedFrom: string | null;
}

// `modules` is what a previous bundle's template sends (with the retired
// `ranking`); the backend drops it.
const CASES: Case[] = [
  {
    name: "blank",
    itemKind: null,
    modules: ["ranking"],
    holds: "Anything",
    switches: ["Check things off"],
    syncedFrom: null,
  },
  {
    name: "todo",
    itemKind: "plain",
    modules: ["todo", "ranking"],
    holds: "Text items",
    switches: ["Check things off"],
    syncedFrom: null,
  },
  {
    name: "links",
    itemKind: "link",
    modules: ["todo", "ranking"],
    holds: "Links and places",
    switches: ["Mark tried"],
    syncedFrom: null,
  },
  {
    name: "movies",
    itemKind: "movie",
    modules: ["todo", "ranking"],
    holds: "Movies",
    switches: ["Mark watched", "Letterboxd match"],
    syncedFrom: "Connect a Letterboxd list",
  },
  {
    name: "tv",
    itemKind: "tv",
    modules: ["todo", "ranking"],
    holds: "TV shows",
    switches: ["Mark watched"],
    syncedFrom: null,
  },
  {
    name: "books",
    itemKind: "book",
    modules: ["todo", "ranking"],
    holds: "Books",
    switches: ["Mark read"],
    syncedFrom: null,
  },
  {
    name: "albums",
    itemKind: "spotify_album",
    modules: ["ranking"],
    holds: "Albums",
    switches: ["Mark listened"],
    syncedFrom: "Connect a Spotify playlist",
  },
];

let user: ScratchUser | null = null;
const listIds = new Map<string, string>();

test.beforeAll(async () => {
  user = await mintScratchUser("features");
  for (const c of CASES) {
    const list = await createScratchList(user, {
      name: `features-${c.name}`,
      itemKind: c.itemKind,
      modules: c.modules,
    });
    listIds.set(c.name, list.id);
  }
});

test.afterAll(async () => cleanupScratchUser(user));

test.beforeEach(async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  await seedSession(page, user.token);
});

for (const c of CASES) {
  test(`${c.name}: Features offers only what the kind supports`, async ({ page }) => {
    await page.goto(`/list/${listIds.get(c.name)}/settings`);
    const features = page.getByTestId("settings-features");
    await expect(features).toBeVisible();
    await expect(page.getByTestId("settings-kind")).toHaveText(c.holds);
    await expect(features.getByRole("switch")).toHaveCount(c.switches.length);
    for (const label of c.switches) {
      await expect(features.getByRole("switch", { name: label })).toBeVisible();
    }
    // The old one-size-fits-all switches are gone everywhere, and so is the
    // retired ordering switch (every list is one hand-ordered sequence).
    await expect(page.getByRole("switch", { name: "Syncing" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: /rank|order/i })).toHaveCount(0);
    await expect(features).not.toContainText(/rank/i);
    if (c.itemKind !== "movie") {
      await expect(page.getByRole("switch", { name: /Letterboxd/ })).toHaveCount(0);
    }
    const synced = page.getByTestId("settings-synced-from");
    if (c.syncedFrom) {
      await expect(synced).toContainText(c.syncedFrom);
    } else {
      await expect(synced).toHaveCount(0);
    }
  });
}

test("a toggle saves and survives a reload", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  const id = listIds.get("books") ?? "";
  await page.goto(`/list/${id}/settings`);
  const markRead = page.getByRole("switch", { name: "Mark read" });
  await expect(markRead).toHaveAttribute("aria-checked", "true");
  await markRead.click();
  await expect(markRead).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("settings-save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Mark read" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  const { list } = await api<{ list: { modules: string[] } }>(user, "GET", `/v1/lists/${id}`);
  expect(list.modules).toEqual([]);
});

test("Letterboxd match brings its own source, so syncing follows it", async ({ page }) => {
  if (!user) throw new Error("no scratch user");
  const id = listIds.get("movies") ?? "";
  await page.goto(`/list/${id}/settings`);
  const match = page.getByRole("switch", { name: "Letterboxd match" });
  await match.click();
  await expect(match).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () => {
      const res = await api<{ list: { modules: string[] }; sources: { kind: string }[] }>(
        user as ScratchUser,
        "GET",
        `/v1/lists/${id}`,
      );
      return [res.list.modules.join(","), res.sources.map((s) => s.kind).join(",")];
    })
    .toEqual(["todo,sources,letterboxd", "letterboxd_match"]);
  // A viewer without Letterboxd is pointed at Settings → Connections.
  await expect(page.getByTestId("settings-letterboxd-connect")).toBeVisible();
  await match.click();
  await expect(match).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(async () => {
      const res = await api<{ list: { modules: string[] }; sources: unknown[] }>(
        user as ScratchUser,
        "GET",
        `/v1/lists/${id}`,
      );
      return [res.list.modules.join(","), res.sources.length];
    })
    .toEqual(["todo", 0]);
});

test("an album shelf with no playlist offers Connect, not Add", async ({ page }) => {
  const id = listIds.get("albums") ?? "";
  await page.goto(`/list/${id}`);
  await expect(page.getByText("No playlist connected")).toBeVisible();
  await expect(page.getByTestId("fab-add-item")).toHaveCount(0);
  await expect(page.getByTestId("list-detail-empty-add")).toHaveCount(0);
  await page.getByTestId("list-detail-empty-connect").click();
  await expect(page).toHaveURL(new RegExp(`/list/${id}/settings$`));
  await expect(page.getByTestId("settings-connect-url")).toBeVisible();
  await page.goto(`/list/${id}/add`);
  await expect(page.getByTestId("add-item-sync-only")).toBeVisible();
});
