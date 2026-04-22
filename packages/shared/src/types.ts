export type WatchStatus = "want_to_watch" | "watched" | "abandoned";

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface WatchlistItem {
  id: string;
  userId: string;
  title: string;
  year: number | null;
  status: WatchStatus;
  rating: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  watchedAt: string | null;
}

export interface RequestMagicLinkBody {
  email: string;
}

export interface RequestMagicLinkResponse {
  ok: true;
}

export interface VerifyMagicLinkBody {
  email: string;
  code: string;
}

export interface VerifyMagicLinkResponse {
  sessionToken: string;
  user: User;
}

export interface CreateWatchlistItemBody {
  title: string;
  year?: number | null;
  status?: WatchStatus;
  notes?: string | null;
}

export interface UpdateWatchlistItemBody {
  title?: string;
  year?: number | null;
  status?: WatchStatus;
  rating?: number | null;
  notes?: string | null;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
}
