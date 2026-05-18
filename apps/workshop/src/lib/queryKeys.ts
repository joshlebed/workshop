export const queryKeys = {
  lists: {
    all: ["lists"] as const,
    detail: (id: string) => ["lists", "detail", id] as const,
  },
  items: {
    /**
     * Per-list split read (`{ ordered, unordered, completed }`). Single key per
     * list since the 2026-05 ordering refactor unified the API into one shape.
     */
    byList: (listId: string) => ["items", "byList", listId] as const,
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
    preview: (url: string) => ["albumShelf", "preview", url] as const,
  },
  gameScores: {
    /** Per-item leaderboard for one period. */
    forItem: (itemId: string, periodKey: string) =>
      ["scores", "forItem", itemId, periodKey] as const,
    /** Aggregated scores for every item on a list for one period. */
    forList: (listId: string, periodKey: string) =>
      ["scores", "forList", listId, periodKey] as const,
  },
  sources: {
    forList: (listId: string) => ["sources", "forList", listId] as const,
  },
} as const;
