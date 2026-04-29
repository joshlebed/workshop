export const queryKeys = {
  lists: {
    all: ["lists"] as const,
    detail: (id: string) => ["lists", "detail", id] as const,
  },
  items: {
    byList: (listId: string) => ["items", "byList", listId] as const,
    byListFiltered: (listId: string, completed: boolean | undefined) =>
      ["items", "byList", listId, { completed: completed ?? "all" }] as const,
    detail: (id: string) => ["items", "detail", id] as const,
  },
  auth: {
    me: ["auth", "me"] as const,
  },
  invites: {
    forList: (listId: string) => ["invites", "forList", listId] as const,
  },
  members: {
    forList: (listId: string) => ["members", "forList", listId] as const,
  },
  activity: {
    feed: ["activity", "feed"] as const,
    feedInfinite: ["activity", "feedInfinite"] as const,
  },
  albumShelf: {
    items: (listId: string) => ["albumShelf", "items", listId] as const,
  },
} as const;
