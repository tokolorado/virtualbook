// app/(noslip)/admin/match-mapping/page.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { assignMatchMapping, moveBackToPending } from "./actions";

export const dynamic = "force-dynamic";

type Tone = "neutral" | "green" | "red" | "yellow" | "blue" | "purple";

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

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

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

  return new Date(ts).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPct(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function getStatusTone(status: string): Tone {
  const s = String(status || "").toLowerCase();

  if (s === "failed") return "red";
  if (s === "needs_review") return "yellow";
  if (s === "mapped") return "green";

  return "neutral";
}

function SurfaceCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-neutral-800 bg-neutral-950/70 shadow-[0_18px_80px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      {children}
    </section>
  );
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const toneClass =
    tone === "green"
      ? "border-green-500/30 bg-green-500/10 text-green-300"
      : tone === "red"
        ? "border-red-500/30 bg-red-500/10 text-red-300"
        : tone === "yellow"
          ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
          : tone === "blue"
            ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
            : tone === "purple"
              ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
              : "border-neutral-800 bg-neutral-950 text-neutral-300";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
        toneClass
      )}
    >
      {children}
    </span>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const toneClass =
    tone === "green"
      ? "border-green-500/20 bg-green-500/10"
      : tone === "red"
        ? "border-red-500/20 bg-red-500/10"
        : tone === "yellow"
          ? "border-yellow-500/20 bg-yellow-500/10"
          : tone === "blue"
            ? "border-sky-500/20 bg-sky-500/10"
            : tone === "purple"
              ? "border-violet-500/20 bg-violet-500/10"
              : "border-neutral-800 bg-neutral-950/80";

  const valueClass =
    tone === "green"
      ? "text-green-300"
      : tone === "red"
        ? "text-red-300"
        : tone === "yellow"
          ? "text-yellow-300"
          : tone === "blue"
            ? "text-sky-300"
            : tone === "purple"
              ? "text-violet-300"
              : "text-white";

  return (
    <div className={cn("rounded-3xl border p-4", toneClass)}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>

      <div className={cn("mt-3 text-2xl font-semibold leading-tight", valueClass)}>
        {value}
      </div>

      {hint ? <div className="mt-2 text-xs leading-5 text-neutral-500">{hint}</div> : null}
    </div>
  );
}

function InfoField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className="mt-2 break-words text-sm font-semibold text-white">
        {value}
      </div>
    </div>
  );
}

async function getReviewItems(): Promise<ReviewRow[]> {
  const supabase = getSupabaseAdmin();

  const nowIso = new Date().toISOString();
  const next24hIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: queueData, error: queueError } = await supabase
    .from("match_mapping_queue")
    .select(
      `
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
    `
    )
    .in("status", ["needs_review", "failed"])
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
    .select(
      `
      match_id,
      sofascore_event_id,
      mapping_method,
      confidence
    `
    )
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

  const failedCount = items.filter((item) => item.status === "failed").length;
  const reviewCount = items.filter((item) => item.status === "needs_review").length;
  const mappedCount = items.filter((item) => !!item.mapping).length;
  const attemptsTotal = items.reduce((sum, item) => sum + item.attempts, 0);

  return (
    <div className="w-full space-y-5 px-4 text-white sm:px-5 xl:px-6 2xl:px-8">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.98))] p-5 sm:p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Admin
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Match mapping review
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Ręczne przypinanie SofaScore event ID dla meczów, których nie
                udało się bezpiecznie zmapować automatycznie.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <StatusPill tone={items.length > 0 ? "yellow" : "green"}>
                  Do review: {items.length}
                </StatusPill>
                <StatusPill tone={failedCount > 0 ? "red" : "neutral"}>
                  Failed: {failedCount}
                </StatusPill>
                <StatusPill tone="blue">Needs review: {reviewCount}</StatusPill>
                <StatusPill>Okno: najbliższe 24h</StatusPill>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/admin"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Wróć do admina
                </Link>

                <Link
                  href="/admin/logs"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Logi cronów
                </Link>

                <a
                  href="/admin/match-mapping"
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                >
                  Odśwież
                </a>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
              <MetricCard
                label="Review queue"
                value={items.length}
                hint="Mecze wymagające decyzji"
                tone={items.length > 0 ? "yellow" : "green"}
              />
              <MetricCard
                label="Failed"
                value={failedCount}
                hint="Automatyzacja nie znalazła pewnego mapowania"
                tone={failedCount > 0 ? "red" : "neutral"}
              />
              <MetricCard
                label="Existing map"
                value={mappedCount}
                hint="Mecze z już znalezionym SofaScore ID"
                tone={mappedCount > 0 ? "green" : "neutral"}
              />
              <MetricCard
                label="Attempts"
                value={attemptsTotal}
                hint="Łączna liczba prób w kolejce"
                tone="blue"
              />
            </div>
          </div>
        </div>
      </SurfaceCard>

      {items.length === 0 ? (
        <SurfaceCard className="p-6">
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                Queue status
              </div>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                Brak meczów w kolejce review
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                Aktualnie nie ma meczów z najbliższych 24 godzin oznaczonych jako
                needs_review albo failed. Kropka w Admin Center powinna pozostać
                niewidoczna.
              </p>
            </div>

            <div className="rounded-3xl border border-green-500/20 bg-green-500/10 p-5">
              <div className="text-[11px] uppercase tracking-[0.18em] text-green-400/80">
                Live state
              </div>
              <div className="mt-3 text-3xl font-semibold text-green-300">
                CLEAN
              </div>
              <div className="mt-2 text-sm text-neutral-400">
                Nic nie wymaga ręcznego mapowania.
              </div>
            </div>
          </div>
        </SurfaceCard>
      ) : (
        <div className="space-y-5">
          {items.map((item) => {
            const searchQuery = `${item.match?.home_team ?? ""} ${
              item.match?.away_team ?? ""
            }`.trim();

            const matchTitle = item.match
              ? `${item.match.home_team} vs ${item.match.away_team}`
              : `matchId ${item.match_id}`;

            return (
              <SurfaceCard key={item.match_id} className="overflow-hidden">
                <div className="border-b border-neutral-800 bg-neutral-900/30 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <StatusPill tone="blue">matchId: {item.match_id}</StatusPill>
                        <StatusPill tone={getStatusTone(item.status)}>
                          {item.status}
                        </StatusPill>
                        <StatusPill>attempts: {item.attempts}</StatusPill>
                        {item.mapping ? (
                          <StatusPill tone="green">
                            map: {item.mapping.sofascore_event_id}
                          </StatusPill>
                        ) : (
                          <StatusPill tone="yellow">no map</StatusPill>
                        )}
                      </div>

                      <h2 className="mt-4 break-words text-2xl font-semibold text-white">
                        {matchTitle}
                      </h2>

                      <p className="mt-2 text-sm text-neutral-400">
                        {item.match?.competition_name ?? "Brak ligi"} ·{" "}
                        {formatDate(item.match?.utc_date ?? null)}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {item.mapping?.sofascore_event_id ? (
                        <a
                          href={`https://www.sofascore.com/event/${item.mapping.sofascore_event_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-sm font-semibold text-green-300 transition hover:bg-green-500/15"
                        >
                          Otwórz SofaScore
                        </a>
                      ) : (
                        <a
                          href={`https://www.sofascore.com/search?q=${encodeURIComponent(
                            searchQuery
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                        >
                          Szukaj na SofaScore
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_430px]">
                  <div className="min-w-0 space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <InfoField label="Liga" value={item.match?.competition_name ?? "—"} />
                      <InfoField label="Data meczu" value={formatDate(item.match?.utc_date ?? null)} />
                      <InfoField label="Updated" value={formatDate(item.updated_at)} />
                      <InfoField label="Next retry" value={formatDate(item.next_retry_at)} />
                    </div>

                    {item.mapping ? (
                      <div className="grid gap-3 md:grid-cols-3">
                        <InfoField
                          label="SofaScore event ID"
                          value={item.mapping.sofascore_event_id}
                        />
                        <InfoField
                          label="Mapping method"
                          value={item.mapping.mapping_method ?? "—"}
                        />
                        <InfoField
                          label="Confidence"
                          value={formatPct(item.mapping.confidence)}
                        />
                      </div>
                    ) : null}

                    <div
                      className={cn(
                        "rounded-3xl border p-4 text-sm leading-6",
                        item.last_error
                          ? "border-red-500/20 bg-red-500/10 text-red-200"
                          : "border-neutral-800 bg-neutral-950/70 text-neutral-400"
                      )}
                    >
                      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                        Last error
                      </div>
                      <div className="mt-2 break-words">
                        {item.last_error ?? "Brak błędu zapisanego w kolejce."}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-neutral-800 bg-neutral-950/70 p-4">
                    <div className="text-lg font-semibold text-white">
                      Ręczne mapowanie
                    </div>
                    <p className="mt-1 text-sm leading-6 text-neutral-400">
                      Wklej SofaScore event ID i zatwierdź mapowanie dla tego
                      meczu.
                    </p>

                    <form action={assignMatchMapping} className="mt-4 space-y-3">
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
                          className="w-full rounded-2xl border border-neutral-800 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
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
                          className="w-full rounded-2xl border border-neutral-800 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-neutral-600"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full rounded-2xl border border-sky-500/30 bg-sky-500/15 px-4 py-3 text-sm font-semibold text-sky-300 transition hover:bg-sky-500/20"
                      >
                        Przypisz mapowanie
                      </button>
                    </form>

                    <form action={moveBackToPending} className="mt-3">
                      <input type="hidden" name="matchId" value={item.match_id} />
                      <button
                        type="submit"
                        className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-900"
                      >
                        Przywróć do pending
                      </button>
                    </form>
                  </div>
                </div>
              </SurfaceCard>
            );
          })}
        </div>
      )}
    </div>
  );
}