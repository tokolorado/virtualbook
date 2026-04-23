import { createClient } from "@supabase/supabase-js";
import { assignMatchMapping, moveBackToPending } from "./actions";

export const dynamic = "force-dynamic";

type MatchDetails = {
  utc_date: string | null;
  competition_name: string | null;
  home_team: string;
  away_team: string;
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
};

type RawReviewRow = {
  match_id: unknown;
  status: unknown;
  attempts: unknown;
  last_error: unknown;
  next_retry_at: unknown;
  updated_at: unknown;
  mapped_at: unknown;
  match?: Array<{
    utc_date?: unknown;
    competition_name?: unknown;
    home_team?: unknown;
    away_team?: unknown;
  }> | null;
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

function normalizeReviewRow(input: RawReviewRow): ReviewRow {
  const firstMatch = Array.isArray(input.match) ? input.match[0] : null;

  return {
    match_id: safeNumber(input.match_id),
    status: safeString(input.status, "needs_review"),
    attempts: safeNumber(input.attempts),
    last_error: safeNullableString(input.last_error),
    next_retry_at: safeNullableString(input.next_retry_at),
    updated_at: safeNullableString(input.updated_at),
    mapped_at: safeNullableString(input.mapped_at),
    match: normalizeMatchDetails(firstMatch),
  };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString();
}

async function getReviewItems(): Promise<ReviewRow[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("match_mapping_queue")
    .select(`
      match_id,
      status,
      attempts,
      last_error,
      next_retry_at,
      updated_at,
      mapped_at,
      match:matches (
        utc_date,
        competition_name,
        home_team,
        away_team
      )
    `)
    .eq("status", "needs_review")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Nie udało się pobrać review items: ${error.message}`);
  }

  return ((data ?? []) as RawReviewRow[]).map(normalizeReviewRow);
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
          {items.map((item) => (
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
                    {item.match?.home_team ?? "Home"} vs{" "}
                    {item.match?.away_team ?? "Away"}
                  </div>

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

                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="rounded-2xl border border-sky-500 bg-sky-500/15 px-4 py-3 text-sm font-semibold text-sky-300"
                      >
                        Przypisz mapowanie
                      </button>
                    </div>
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
          ))}
        </div>
      )}
    </section>
  );
}