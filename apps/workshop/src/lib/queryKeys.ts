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
  tags: {
    /** Per-list in-use tags + counts (`GET /v1/lists/:id/tags`). */
    byList: (listId: string) => ["tags", "byList", listId] as const,
  },
  views: {
    /** Per-list saved views (`GET /v1/lists/:id/views`). */
    byList: (listId: string) => ["views", "byList", listId] as const,
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
  sourcePreview: {
    /**
     * Per-source-kind preview cache keyed by the user's input string. Used
     * by the create-list flow before the source is persisted; the entry is
     * keyed on `kind` because two source kinds may share an identical URL
     * shape only by coincidence.
     */
    forKind: (kind: string, input: string) => ["sourcePreview", kind, input] as const,
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
  letterboxd: {
    /** Per-list member connection + sync status (`GET /v1/lists/:id/letterboxd`). */
    status: (listId: string) => ["letterboxd", "status", listId] as const,
  },
  games: {
    /** `GET /v1/games` — My Games with each game's standings for one period. */
    mine: (periodKey: string) => ["games", "mine", periodKey] as const,
    /** `GET /v1/games/:id/leaderboard` for one period. */
    leaderboard: (gameId: string, periodKey: string) =>
      ["games", "leaderboard", gameId, periodKey] as const,
  },
  friends: {
    /** `GET /v1/friends` — my accepted friends. */
    all: ["friends"] as const,
    /** `GET /v1/friends/requests/:token` — public inviter preview. */
    requestPreview: (inviteToken: string) => ["friends", "requestPreview", inviteToken] as const,
  },
} as const;
