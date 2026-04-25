export const queryKeys = {
  lists: {
    all: ["lists"] as const,
    detail: (id: string) => ["lists", "detail", id] as const,
  },
  items: {
    byList: (listId: string) => ["items", "byList", listId] as const,
    detail: (id: string) => ["items", "detail", id] as const,
  },
  auth: {
    me: ["auth", "me"] as const,
  },
} as const;
