// app/(noslip)/admin/match-mapping/page.tsx
import { createClient } from "@supabase/supabase-js";
import { assignMatchMapping, moveBackToPending } from "./actions";

export const dynamic = "force-dynamic";

type MatchDetails = {
  utc_date: string | null;
  competition_name: string | null;
  home_team: string;
  away_team: string;
};

type MappingDetails = {
  sofascore_event_id: number;
  mapping_method: string | null;
  confidence: number | null;
};

type ReviewRow = {
  match_id: number;
  status: string;
  attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
  updated_at: string | null;
  mapped_at: string | null;
  match: MatchDetails | null;
  mapping: MappingDetails | null;
};

type RawMatchDetails = {
  utc_date?: unknown;
  competition_name?: unknown;
  home_team?: unknown;
  away_team?: unknown;
};

type RawQueueRow = {
  match_id: unknown;
  status: unknown;
  attempts: unknown;
  last_error: unknown;
  next_retry_at: unknown;
  updated_at: unknown;
  mapped_at: unknown;
  match?: RawMatchDetails | RawMatchDetails[] | null;
};

type RawMappingRow = {
  match_id?: unknown;
  sofascore_event_id?: unknown;
  mapping_method?: unknown;
  confidence?: unknown;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Brak konfiguracji SUPABASE dla admin match mapping.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function safeNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeNullableNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function safeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMatchDetails(input: unknown): MatchDetails | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;

  return {
    utc_date: safeNullableString(row.utc_date),
    competition_name: safeNullableString(row.competition_name),
    home_team: safeString(row.home_team, "Home"),
    away_team: safeString(row.away_team, "Away"),
  };
}

function normalizeMappingDetails(input: unknown): MappingDetails | null {
  if (typeof input !== "object" || input === null) return null;

  const row = input as Record<string, unknown>;
  const eventId = safeNullableNumber(row.sofascore_event_id);

  if (eventId === null) return null;

  return {
    sofascore_event_id: eventId,
    mapping_method: safeNullableString(row.mapping_method),
    confidence: safeNullableNumber(row.confidence),
  };
}

function normalizeQueueRow(input: RawQueueRow): Omit<ReviewRow, "mapping"> {
  const rawMatch = Array.isArray(input.match)
    ? input.match[0] ?? null
    : input.match ?? null;

  return {
    match_id: safeNumber(input.match_id),
    status: safeString(input.status, "needs_review"),
    attempts: safeNumber(input.attempts),
    last_error: safeNullableString(input.last_error),
    next_retry_at: safeNullableString(input.next_retry_at),
    updated_at: safeNullableString(input.updated_at),
    mapped_at: safeNullableString(input.mapped_at),
    match: normalizeMatchDetails(rawMatch),
  };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString("pl-PL");
}

async function getReviewItems(): Promise<ReviewRow[]> {
  const supabase = getSupabaseAdmin();

  const nowIso = new Date().toISOString();
  const next24hIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: queueData, error: queueError } = await supabase
    .from("match_mapping_queue")
    .select(`
      match_id,
      status,
      attempts,
      last_error,
      next_retry_at,
      updated_at,
      mapped_at,
      match:matches!inner (
        utc_date,
        competition_name,
        home_team,
        away_team
      )
    `)
    .eq("status", "needs_review")
    .gte("match.utc_date", nowIso)
    .lte("match.utc_date", next24hIso)
    .order("utc_date", {
      referencedTable: "matches",
      ascending: true,
    })
    .limit(100);

  if (queueError) {
    throw new Error(`Nie udało się pobrać review items: ${queueError.message}`);
  }

  const queueRows = ((queueData ?? []) as unknown as RawQueueRow[])
    .map(normalizeQueueRow)
    .filter((row) => row.match_id > 0);

  if (queueRows.length === 0) {
    return [];
  }

  const matchIds = queueRows.map((row) => row.match_id);

  const { data: mappingData, error: mappingError } = await supabase
    .from("match_sofascore_map")
    .select(`
      match_id,
      sofascore_event_id,
      mapping_method,
      confidence
    `)
    .in("match_id", matchIds);

  if (mappingError) {
    throw new Error(
      `Nie udało się pobrać istniejących mapowań: ${mappingError.message}`
    );
  }

  const mappingByMatchId = new Map<number, MappingDetails>();

  for (const rawMapping of (mappingData ?? []) as unknown as RawMappingRow[]) {
    const matchId = safeNullableNumber(rawMapping.match_id);
    const mapping = normalizeMappingDetails(rawMapping);

    if (matchId !== null && mapping) {
      mappingByMatchId.set(matchId, mapping);
    }
  }

  return queueRows.map((row) => ({
    ...row,
    mapping: mappingByMatchId.get(row.match_id) ?? null,
  }));
}

export default async function AdminMatchMappingPage() {
  const items = await getReviewItems();

  return (
    <section className="mx-auto max-w-7xl p-6">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.22em] text-neutral-500">
          Admin
        </div>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          Match mapping review
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Ręczne przypinanie SofaScore event ID dla meczów oznaczonych jako
          <span className="ml-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-yellow-300">
            needs_review
          </span>
          .
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-300">
          Brak meczów w kolejce review.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const searchQuery = `${item.match?.home_team ?? ""} ${
              item.match?.away_team ?? ""
            }`.trim();

            return (
              <div
                key={item.match_id}
                className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
                        matchId: {item.match_id}
                      </span>
                      <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-300">
                        {item.status}
                      </span>
                      <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
                        attempts: {item.attempts}
                      </span>
                    </div>

                    <div className="mt-4 text-xl font-semibold text-white">
                      {item.match
                        ? `${item.match.home_team} vs ${item.match.away_team}`
                        : `matchId ${item.match_id}`}
                    </div>

                    {item.mapping?.sofascore_event_id ? (
                      <a
                        href={`https://www.sofascore.com/event/${item.mapping.sofascore_event_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex rounded-2xl border border-green-500 bg-green-500/10 px-4 py-2 text-sm font-semibold text-green-300 hover:bg-green-500/15"
                      >
                        Otwórz mecz na SofaScore
                      </a>
                    ) : (
                      <a
                        href={`https://www.sofascore.com/search?q=${encodeURIComponent(
                          searchQuery
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-900"
                      >
                        Szukaj na SofaScore
                      </a>
                    )}

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-400">
                      <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1">
                        Liga: {item.match?.competition_name ?? "—"}
                      </span>
                      <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1">
                        Data: {formatDate(item.match?.utc_date ?? null)}
                      </span>
                      <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1">
                        Updated: {formatDate(item.updated_at)}
                      </span>
                      <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1">
                        Next retry: {formatDate(item.next_retry_at)}
                      </span>
                    </div>

                    <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      {item.last_error ?? "Brak błędu"}
                    </div>
                  </div>

                  <div className="w-full xl:w-[420px]">
                    <form action={assignMatchMapping} className="space-y-3">
                      <input type="hidden" name="matchId" value={item.match_id} />
                      <input type="hidden" name="mappingMethod" value="manual" />
                      <input type="hidden" name="confidence" value="1" />

                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">
                          SofaScore event ID
                        </label>
                        <input
                          name="sofascoreEventId"
                          type="number"
                          required
                          placeholder="np. 14083330"
                          className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">
                          Notes
                        </label>
                        <input
                          name="notes"
                          type="text"
                          defaultValue="manual review assign"
                          className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500"
                        />
                      </div>

                      <button
                        type="submit"
                        className="rounded-2xl border border-sky-500 bg-sky-500/15 px-4 py-3 text-sm font-semibold text-sky-300"
                      >
                        Przypisz mapowanie
                      </button>
                    </form>

                    <form action={moveBackToPending} className="mt-3">
                      <input type="hidden" name="matchId" value={item.match_id} />
                      <button
                        type="submit"
                        className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-white"
                      >
                        Przywróć do pending
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}