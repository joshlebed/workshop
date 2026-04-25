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
} as const;
