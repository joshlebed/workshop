import type {
  BulkImportBody,
  CreateRecItemBody,
  ExportCsvResponse,
  ImportCsvBody,
  ImportCsvResponse,
  ListRecItemsResponse,
  RecCategory,
  RecItem,
  RequestMagicLinkBody,
  RequestMagicLinkResponse,
  UpdateRecItemBody,
  VerifyMagicLinkBody,
  VerifyMagicLinkResponse,
} from "@workshop/shared";
import { API_URL } from "../config";
import { loadSession } from "../lib/storage";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { auth?: boolean } = { auth: true },
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth !== false) {
    const token = await loadSession();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  const looksJson = contentType.includes("application/json") || /^\s*[{[]/.test(text);
  let payload: Record<string, unknown> | null = null;
  if (text && looksJson) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : res.status === 401
          ? "unauthorized"
          : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  if (text && !payload) {
    throw new ApiError(
      res.status,
      `expected JSON from ${path} but got ${contentType || "unknown"}`,
    );
  }
  return payload as T;
}

export const api = {
  requestMagicLink: (body: RequestMagicLinkBody) =>
    request<RequestMagicLinkResponse>("POST", "/auth/request", body, { auth: false }),
  verifyMagicLink: (body: VerifyMagicLinkBody) =>
    request<VerifyMagicLinkResponse>("POST", "/auth/verify", body, { auth: false }),

  listItems: (category?: RecCategory) =>
    request<ListRecItemsResponse>("GET", category ? `/items?category=${category}` : "/items"),
  createItem: (body: CreateRecItemBody) => request<RecItem>("POST", "/items", body),
  updateItem: (id: string, body: UpdateRecItemBody) =>
    request<RecItem>("PATCH", `/items/${id}`, body),
  incrementItem: (id: string) => request<RecItem>("POST", `/items/${id}/increment`),
  decrementItem: (id: string) =>
    request<RecItem | { deleted: true; id: string }>("POST", `/items/${id}/decrement`),
  deleteItem: (id: string) => request<{ ok: true }>("DELETE", `/items/${id}`),

  bulkImport: (body: BulkImportBody) => request<{ imported: number }>("POST", "/items/bulk", body),
  importCsv: (body: ImportCsvBody) => request<ImportCsvResponse>("POST", "/items/import-csv", body),
  exportCsv: () => request<ExportCsvResponse>("GET", "/items/export-csv"),
};

export { ApiError };
