// lib/bsd/client.ts

const BSD_BASE_URL = "https://sports.bzzoiro.com/api";
const BSD_V2_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const BSD_IMAGE_BASE_URL = "https://sports.bzzoiro.com/img";

export type BsdListResponse<T> = {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: T[];
};

export class BsdApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "BsdApiError";
    this.status = status;
    this.payload = payload;
  }
}

function getBsdApiKey() {
  const key = process.env.BSD_API_KEY;

  if (!key) {
    throw new BsdApiError("Missing BSD_API_KEY in env", 500, {
      error: "Missing BSD_API_KEY in env",
    });
  }

  return key;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function buildBsdUrl(pathOrUrl: string, params?: Record<string, string | number | boolean | null | undefined>) {
  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(`${BSD_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url;
}

function buildBsdV2Url(pathOrUrl: string, params?: Record<string, string | number | boolean | null | undefined>) {
  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(`${BSD_V2_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url;
}

export async function bsdFetchJson<T>(
  pathOrUrl: string,
  params?: Record<string, string | number | boolean | null | undefined>
): Promise<T> {
  const apiKey = getBsdApiKey();
  const url = buildBsdUrl(pathOrUrl, params);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();
  const payload = safeJson(text);

  if (!response.ok) {
    throw new BsdApiError(
      `BSD API error ${response.status}`,
      response.status,
      payload
    );
  }

  return payload as T;
}

export async function bsdFetchV2Json<T>(
  pathOrUrl: string,
  params?: Record<string, string | number | boolean | null | undefined>
): Promise<T> {
  const apiKey = getBsdApiKey();
  const url = buildBsdV2Url(pathOrUrl, params);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();
  const payload = safeJson(text);

  if (!response.ok) {
    throw new BsdApiError(
      `BSD v2 API error ${response.status}`,
      response.status,
      payload
    );
  }

  return payload as T;
}

export async function bsdFetchPaginated<T>(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
  options?: { maxPages?: number }
): Promise<{
  results: T[];
  pages: Array<{
    page: number;
    url: string;
    count: number | null;
    resultsCount: number;
    hasNext: boolean;
  }>;
}> {
  const maxPages = options?.maxPages ?? 20;

  let nextUrl: string | null = buildBsdUrl(path, params).toString();

  const results: T[] = [];
  const pages: Array<{
    page: number;
    url: string;
    count: number | null;
    resultsCount: number;
    hasNext: boolean;
  }> = [];

  for (let page = 1; page <= maxPages && nextUrl; page += 1) {
    const currentUrl: string = nextUrl;

    const payload: BsdListResponse<T> =
      await bsdFetchJson<BsdListResponse<T>>(currentUrl);

    const pageResults: T[] = Array.isArray(payload.results)
      ? payload.results
      : [];

    results.push(...pageResults);

    pages.push({
      page,
      url: currentUrl,
      count: typeof payload.count === "number" ? payload.count : null,
      resultsCount: pageResults.length,
      hasNext: Boolean(payload.next),
    });

    nextUrl = typeof payload.next === "string" && payload.next
      ? payload.next
      : null;
  }

  return {
    results,
    pages,
  };
}

export function bsdImageUrl(
  type: "team" | "league" | "player" | "manager" | "venue",
  id: number | string | null | undefined
) {
  if (id === null || id === undefined || id === "") return null;
  return `${BSD_IMAGE_BASE_URL}/${type}/${encodeURIComponent(String(id))}/`;
}

export function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function safeInt(value: unknown): number | null {
  const n = safeNumber(value);
  if (n === null) return null;
  return Math.trunc(n);
}

export function normalizeBsdText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeBsdStatus(status: unknown) {
  const s = String(status ?? "").toLowerCase();

  if (s === "inprogress" || s === "1st_half" || s === "2nd_half") return "IN_PLAY";
  if (s === "halftime") return "PAUSED";
  if (s === "finished") return "FINISHED";
  if (s === "postponed") return "POSTPONED";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  if (s === "notstarted") return "TIMED";

  return s ? s.toUpperCase() : "TIMED";
}
