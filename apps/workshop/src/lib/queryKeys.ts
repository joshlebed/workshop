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
  spotify: {
    status: ["spotify", "status"] as const,
    savedAlbums: ["spotify", "savedAlbums"] as const,
    search: (q: string) => ["spotify", "search", q] as const,
    nowPlaying: ["spotify", "nowPlaying"] as const,
    recent: ["spotify", "recent"] as const,
    playlists: ["spotify", "playlists"] as const,
    playlistTracks: (id: string) => ["spotify", "playlists", id, "tracks"] as const,
  },
} as const;
