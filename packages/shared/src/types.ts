export type RecCategory = "movie" | "tv" | "book";

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface RecItem {
  id: string;
  userId: string;
  title: string;
  category: RecCategory;
  count: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface MeResponse {
  user: User;
}

export interface CreateRecItemBody {
  title: string;
  category: RecCategory;
}

export interface UpdateRecItemBody {
  title?: string;
  completed?: boolean;
  count?: number;
}

export interface ListRecItemsResponse {
  items: RecItem[];
}

export interface BulkImportBody {
  category: RecCategory;
  titles: string[];
}

export interface ImportCsvBody {
  csv: string;
}

export interface ImportCsvResponse {
  imported: number;
}

export interface ExportCsvResponse {
  csv: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
}
