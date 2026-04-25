// app/(main)/events/page.tsx
"use client";

import type { ReactNode } from "react";
import { formatOdd } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import DayBar from "@/components/DayBar";
import { todayLocalYYYYMMDD, localDateKeyFromISO } from "@/lib/date";
import { useBetSlip } from "@/lib/BetSlipContext";

type Pick = "1" | "X" | "2";
type SortMode = "smart" | "time" | "league";

type Match = {
  id: string;
  competitionCode: string;
  competitionName: string;
  leagueLine: string;
  homeId: number | null;
  awayId: number | null;
  home: string;
  away: string;
  time: string;
  kickoffUtc: string;
  status: string;
  isLive: boolean;
  isFinished: boolean;
  homeScore: number | null;
  awayScore: number | null;
  odds: { "1": number | null; X: number | null; "2": number | null };
};

type Odds1x2DbRow = {
  match_id: number;
  selection: string;
  book_odds: number | string | null;
  updated_at: string | null;
  engine_version: string | null;
};

type League = {
  code: string;
  name: string;
};

type StandingsRowUI = {
  position: number;
  teamId: number;
  teamName: string;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  form?: string | null;
};

type StandingsUI = {
  competitionCode: string;
  competitionName: string;
  season?: string | null;
  rows: StandingsRowUI[];
};

type MatchAvailability = {
  live: boolean;
  finished: boolean;
  closed: boolean;
  closedReason: string | null;
};

const FREE_TIER_LEAGUES: League[] = [
  { code: "CL", name: "Champions League" },
  { code: "PL", name: "Premier League" },
  { code: "BL1", name: "Bundesliga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "SA", name: "Serie A (Italy)" },
  { code: "PD", name: "LaLiga" },
  { code: "WC", name: "World Cup" },
];

const MARKET_ID_1X2 = "1x2";
const BETTING_CLOSE_BUFFER_MS = 60_000;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatForm(form?: string | null) {
  if (!form) return null;
  const cleaned = form.replace(/\s+/g, "");
  const parts = cleaned.includes(",")
    ? cleaned.split(",")
    : cleaned.includes("-")
      ? cleaned.split("-")
      : [cleaned];

  return parts.filter(Boolean).slice(0, 5);
}

function formatLocalTime(value: string) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "—";

  return new Date(ts).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocalDateTime(value: string) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "—";

  return new Date(ts).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatKickoffDistance(kickoffUtc: string, nowMs: number) {
  const ts = Date.parse(kickoffUtc);
  if (!Number.isFinite(ts)) return null;

  const diffMs = ts - nowMs;
  const absMin = Math.abs(Math.round(diffMs / 60_000));

  if (diffMs >= 0) {
    if (absMin < 1) return "start za chwilę";
    if (absMin < 60) return `start za ${absMin} min`;
    const hours = Math.floor(absMin / 60);
    const mins = absMin % 60;
    return mins > 0 ? `start za ${hours}h ${mins}m` : `start za ${hours}h`;
  }

  if (absMin < 60) return `w toku od ${absMin} min`;
  const hours = Math.floor(absMin / 60);
  const mins = absMin % 60;
  return mins > 0 ? `po starcie ${hours}h ${mins}m` : `po starcie ${hours}h`;
}

function isBettingClosed(kickoffUtc: string, nowMs: number) {
  const t = Date.parse(kickoffUtc);
  if (!Number.isFinite(t)) return false;
  return nowMs >= t - BETTING_CLOSE_BUFFER_MS;
}

function isLiveStatus(status?: string | null) {
  const s = String(status || "").toUpperCase();
  return s === "LIVE" || s === "IN_PLAY" || s === "PAUSED";
}

function isFinishedStatus(status?: string | null) {
  const s = String(status || "").toUpperCase();
  return s === "FINISHED";
}

function getMatchAvailability(m: Match, nowMs: number): MatchAvailability {
  const live = m.isLive || isLiveStatus(m.status);
  const finished = m.isFinished || isFinishedStatus(m.status);
  const closedByKickoff = isBettingClosed(m.kickoffUtc, nowMs);

  if (live) {
    return {
      live,
      finished,
      closed: true,
      closedReason: "Zakłady są zamknięte, bo mecz jest LIVE.",
    };
  }

  if (finished) {
    return {
      live,
      finished,
      closed: true,
      closedReason: "Zakłady są zamknięte, bo mecz jest zakończony.",
    };
  }

  if (closedByKickoff) {
    return {
      live,
      finished,
      closed: true,
      closedReason: "Zakłady zamykają się minutę przed startem meczu.",
    };
  }

  return {
    live,
    finished,
    closed: false,
    closedReason: null,
  };
}

function hasVisibleScore(m: Match) {
  return m.homeScore !== null || m.awayScore !== null;
}

function ymdToUtcMs(ymd: string) {
  const t = Date.parse(`${ymd}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : NaN;
}

function isBeyondHorizonDay(selectedYmd: string, horizonYmd: string | null) {
  if (!horizonYmd) return false;

  const a = ymdToUtcMs(selectedYmd);
  const b = ymdToUtcMs(horizonYmd);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a > b;
}

function matchSortWeight(m: Match, nowMs: number) {
  if (m.isLive || isLiveStatus(m.status)) return 0;

  const kickoff = Date.parse(m.kickoffUtc);
  if (!Number.isFinite(kickoff)) return 3;

  if (kickoff > nowMs) return 1;
  if (m.isFinished || isFinishedStatus(m.status)) return 3;

  return 2;
}

function sortMatches(list: Match[], nowMs: number) {
  return [...list].sort((a, b) => {
    const wa = matchSortWeight(a, nowMs);
    const wb = matchSortWeight(b, nowMs);

    if (wa !== wb) return wa - wb;

    const ta = new Date(a.kickoffUtc).getTime();
    const tb = new Date(b.kickoffUtc).getTime();

    if (ta !== tb) return ta - tb;

    return a.competitionName.localeCompare(b.competitionName, "pl");
  });
}

function sortMatchesByMode(list: Match[], nowMs: number, sortMode: SortMode) {
  if (sortMode === "time") {
    return [...list].sort((a, b) => {
      const ta = Date.parse(a.kickoffUtc);
      const tb = Date.parse(b.kickoffUtc);

      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
        return ta - tb;
      }

      return a.competitionName.localeCompare(b.competitionName, "pl");
    });
  }

  if (sortMode === "league") {
    return [...list].sort((a, b) => {
      const league = a.competitionName.localeCompare(b.competitionName, "pl");
      if (league !== 0) return league;

      const ta = Date.parse(a.kickoffUtc);
      const tb = Date.parse(b.kickoffUtc);

      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
      return a.home.localeCompare(b.home, "pl");
    });
  }

  return sortMatches(list, nowMs);
}

function pickLabel(pick: Pick) {
  if (pick === "1") return "Gospodarze";
  if (pick === "X") return "Remis";
  return "Goście";
}

function shortPickLabel(pick: Pick) {
  if (pick === "1") return "1";
  if (pick === "X") return "X";
  return "2";
}

function buildMatchesFromPayload(payload: any, selectedDate: string): Match[] {
  const all: Match[] = [];

  for (const item of payload?.results ?? []) {
    const league = item?.league;
    const code = league?.code;

    if (!code) continue;

    const fixtures = item?.fixtures;
    const competitionName = fixtures?.competition?.name ?? league?.name ?? code;
    const list = Array.isArray(fixtures?.matches) ? fixtures.matches : [];

    for (const m of list) {
      const utc = m?.utcDate;
      if (!utc) continue;

      const time = formatLocalTime(utc);

      const homeId =
        typeof m?.homeTeam?.id === "number" ? m.homeTeam.id : null;
      const awayId =
        typeof m?.awayTeam?.id === "number" ? m.awayTeam.id : null;

      const homeName = m?.homeTeam?.name ?? "Home";
      const awayName = m?.awayTeam?.name ?? "Away";

      all.push({
        id: String(m.id),
        competitionCode: code,
        competitionName,
        leagueLine: `${competitionName} • ${time}`,
        homeId,
        awayId,
        home: homeName,
        away: awayName,
        time,
        kickoffUtc: utc,
        status: String(m?.status ?? "SCHEDULED"),
        isLive: Boolean(m?.live?.isLive),
        isFinished: Boolean(m?.live?.isFinished),
        homeScore:
          typeof m?.score?.fullTime?.home === "number"
            ? m.score.fullTime.home
            : null,
        awayScore:
          typeof m?.score?.fullTime?.away === "number"
            ? m.score.fullTime.away
            : null,
        odds: {
          "1": m?.odds?.["1"] ?? null,
          X: m?.odds?.X ?? null,
          "2": m?.odds?.["2"] ?? null,
        },
      });
    }
  }

  return all.filter((m) => localDateKeyFromISO(m.kickoffUtc) === selectedDate);
}

async function hydrateMatchesWithDbOdds(baseMatches: Match[]) {
  if (!baseMatches.length) {
    return {
      matches: baseMatches,
      latestOddsUpdatedAt: null as string | null,
    };
  }

  const matchIds = baseMatches
    .map((m) => Number(m.id))
    .filter((id) => Number.isFinite(id));

  if (!matchIds.length) {
    return {
      matches: baseMatches,
      latestOddsUpdatedAt: null as string | null,
    };
  }

  const { data, error } = await supabase
    .from("odds")
    .select("match_id, selection, book_odds, updated_at, engine_version")
    .in("match_id", matchIds)
    .eq("market_id", MARKET_ID_1X2)
    .eq("engine_version", "v2");

  if (error) {
    throw new Error(`Nie udało się pobrać kursów 1X2 z bazy: ${error.message}`);
  }

  const byMatch = new Map<string, Match["odds"]>();
  let latestOddsUpdatedAt: string | null = null;

  for (const row of (data ?? []) as Odds1x2DbRow[]) {
    const matchId = String(row.match_id);
    const selection = String(row.selection) as Pick;

    if (selection !== "1" && selection !== "X" && selection !== "2") continue;

    const odd = safeNum(row.book_odds);
    const current = byMatch.get(matchId) ?? { "1": null, X: null, "2": null };

    current[selection] = odd;
    byMatch.set(matchId, current);

    if (typeof row.updated_at === "string" && row.updated_at) {
      if (
        !latestOddsUpdatedAt ||
        Date.parse(row.updated_at) > Date.parse(latestOddsUpdatedAt)
      ) {
        latestOddsUpdatedAt = row.updated_at;
      }
    }
  }

  return {
    matches: baseMatches.map((m) => {
      const dbOdds = byMatch.get(m.id);

      return {
        ...m,
        odds: {
          "1": dbOdds?.["1"] ?? m.odds["1"],
          X: dbOdds?.X ?? m.odds.X,
          "2": dbOdds?.["2"] ?? m.odds["2"],
        },
      };
    }),
    latestOddsUpdatedAt,
  };
}

function SurfaceCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-neutral-800 bg-neutral-950/70 shadow-[0_18px_80px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      {children}
    </div>
  );
}

function SmallPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "red" | "green" | "yellow" | "blue";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
        tone === "red" && "border-red-500/30 bg-red-500/10 text-red-300",
        tone === "green" && "border-green-500/30 bg-green-500/10 text-green-300",
        tone === "yellow" &&
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
        tone === "blue" && "border-sky-500/30 bg-sky-500/10 text-sky-300",
        tone === "neutral" &&
          "border-neutral-800 bg-neutral-950 text-neutral-300"
      )}
    >
      {children}
    </span>
  );
}

function StatMiniCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "red" | "green" | "yellow" | "blue";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "neutral" && "border-neutral-800 bg-neutral-950/80",
        tone === "red" && "border-red-500/20 bg-red-500/10",
        tone === "green" && "border-green-500/20 bg-green-500/10",
        tone === "yellow" && "border-yellow-500/20 bg-yellow-500/10",
        tone === "blue" && "border-sky-500/20 bg-sky-500/10"
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-white">{value}</div>
      {hint ? <div className="mt-1 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}

function SectionHeader({
  title,
  count,
  subtitle,
  badgeClassName,
}: {
  title: string;
  count: number;
  subtitle?: ReactNode;
  badgeClassName?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-neutral-100">{title}</h3>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
              badgeClassName ??
                "border-neutral-800 bg-neutral-950 text-neutral-300"
            )}
          >
            {count}
          </span>
        </div>
        {subtitle ? <div className="mt-1 text-xs text-neutral-500">{subtitle}</div> : null}
      </div>
    </div>
  );
}

function LoadingMatchesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-3xl border border-neutral-800 bg-neutral-950/70 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="h-3 w-44 rounded bg-neutral-800" />
            <div className="h-6 w-28 rounded-full bg-neutral-800" />
          </div>

          <div className="mt-4 grid gap-2">
            <div className="h-5 w-72 rounded bg-neutral-800" />
            <div className="h-5 w-56 rounded bg-neutral-800" />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="h-14 rounded-2xl bg-neutral-800" />
            <div className="h-14 rounded-2xl bg-neutral-800" />
            <div className="h-14 rounded-2xl bg-neutral-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyStateCard({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <SurfaceCard className="p-6">
      <div className="max-w-2xl">
        <div className="text-base font-semibold text-white">{title}</div>
        <div className="mt-2 text-sm leading-6 text-neutral-400">
          {description}
        </div>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </SurfaceCard>
  );
}

function TeamNameLine({
  name,
  score,
  highlight,
}: {
  name: string;
  score: number | null;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div
        className={cn(
          "min-w-0 truncate text-base font-semibold leading-7 sm:text-lg",
          highlight ? "text-white" : "text-neutral-100"
        )}
      >
        {name}
      </div>

      {score !== null ? (
        <div className="min-w-8 rounded-xl border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-center text-sm font-semibold text-white">
          {score}
        </div>
      ) : null}
    </div>
  );
}

function MatchStatusPill({
  match,
  nowMs,
}: {
  match: Match;
  nowMs: number;
}) {
  const availability = getMatchAvailability(match, nowMs);

  if (availability.live) {
    return <SmallPill tone="red">LIVE</SmallPill>;
  }

  if (availability.finished) {
    return <SmallPill>Zakończony</SmallPill>;
  }

  if (availability.closed) {
    return <SmallPill tone="yellow">Zamknięte</SmallPill>;
  }

  return <SmallPill tone="green">Pre-match</SmallPill>;
}

function LeagueButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition",
        active
          ? "border-white/20 bg-white text-black shadow-[0_10px_40px_rgba(255,255,255,0.08)]"
          : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-900"
      )}
    >
      <span className="min-w-0 truncate text-sm font-semibold">{label}</span>
      <span
        className={cn(
          "ml-3 rounded-full border px-2 py-0.5 text-xs",
          active
            ? "border-black/15 bg-black/5 text-black"
            : "border-neutral-700 text-neutral-300"
        )}
      >
        {count}
      </span>
    </button>
  );
}

export default function EventsPage() {
  const router = useRouter();
  const { addToSlip, removeFromSlip, isActivePick } = useBetSlip();

  const [selectedDate, setSelectedDate] = useState<string>(() =>
    todayLocalYYYYMMDD()
  );
  const [selectedLeague, setSelectedLeague] = useState<string>("ALL");
  const [activeRightTab, setActiveRightTab] = useState<"matches" | "table">(
    "matches"
  );
  const [sortMode, setSortMode] = useState<SortMode>("smart");
  const [searchQuery, setSearchQuery] = useState("");

  const [enabledDates, setEnabledDates] = useState<string[]>([]);
  const [enabledDatesLoaded, setEnabledDatesLoaded] = useState(false);

  const [matches, setMatches] = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [matchesLoadedAt, setMatchesLoadedAt] = useState<string | null>(null);

  const [beyondHorizon, setBeyondHorizon] = useState(false);
  const [horizonYmd, setHorizonYmd] = useState<string | null>(null);

  const [standings, setStandings] = useState<StandingsUI | null>(null);
  const [loadingStandings, setLoadingStandings] = useState(false);
  const [standingsError, setStandingsError] = useState<string | null>(null);

  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [reloadKey, setReloadKey] = useState(0);

  const [syncingOdds, setSyncingOdds] = useState(false);
  const oddsSyncInFlightRef = useRef(false);

  const matchesCacheRef = useRef<Record<string, Match[]>>({});
  const matchesLoadedAtCacheRef = useRef<Record<string, string | null>>({});
  const horizonCacheRef = useRef<Record<string, string | null>>({});
  const beyondCacheRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const isToday = selectedDate === todayLocalYYYYMMDD();
    if (!isToday) return;

    const hasLiveNow = matches.some((m) => m.isLive || isLiveStatus(m.status));
    if (!hasLiveNow) return;

    const id = window.setInterval(() => {
      delete matchesCacheRef.current[selectedDate];
      delete matchesLoadedAtCacheRef.current[selectedDate];
      delete horizonCacheRef.current[selectedDate];
      delete beyondCacheRef.current[selectedDate];
      setReloadKey((v) => v + 1);
    }, 30_000);

    return () => window.clearInterval(id);
  }, [selectedDate, matches]);

  const selectedLeagueLabel = useMemo(() => {
    if (selectedLeague === "ALL") return "Wszystkie ligi";

    return (
      FREE_TIER_LEAGUES.find((x) => x.code === selectedLeague)?.name ??
      selectedLeague
    );
  }, [selectedLeague]);

  const loadEnabledDates = useCallback(async (preferredDate?: string) => {
    try {
      setEnabledDatesLoaded(false);

      const base = todayLocalYYYYMMDD();

      const r = await fetch(
        `/api/events-enabled-dates?from=${encodeURIComponent(base)}&days=14`,
        { cache: "no-store" }
      );

      const text = await r.text();
      let payload: any = null;

      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }

      if (!r.ok || !Array.isArray(payload?.enabledDates)) {
        throw new Error(payload?.error || "Nie udało się pobrać dni z meczami.");
      }

      const arr = [...payload.enabledDates].sort();
      setEnabledDates(arr);

      if (arr.length > 0 && preferredDate && !arr.includes(preferredDate)) {
        setSelectedDate(arr[0]);
      }

      setEnabledDatesLoaded(true);
    } catch {
      setEnabledDates([]);
      setEnabledDatesLoaded(true);
    }
  }, []);

  const refreshCurrentDay = () => {
    delete matchesCacheRef.current[selectedDate];
    delete matchesLoadedAtCacheRef.current[selectedDate];
    delete horizonCacheRef.current[selectedDate];
    delete beyondCacheRef.current[selectedDate];
    setReloadKey((v) => v + 1);
  };

  useEffect(() => {
    let cancelled = false;

    const checkBanned = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;

        if (!userId) return;

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("is_banned")
          .eq("id", userId)
          .maybeSingle();

        if (cancelled) return;
        if (error) return;

        if (profile?.is_banned) {
          router.replace("/");
        }
      } catch {
        // intentional no-op
      }
    };

    void checkBanned();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    const checkAdmin = async () => {
      try {
        setCheckingAdmin(true);

        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;

        if (!userId) {
          if (!cancelled) setIsAdmin(false);
          return;
        }

        const { data, error } = await supabase
          .from("admins")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (!cancelled) {
          setIsAdmin(!error && !!data);
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setCheckingAdmin(false);
      }
    };

    void checkAdmin();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadEnabledDates(selectedDate);
  }, [loadEnabledDates, selectedDate]);

  async function manualSyncOddsForDay(args: { date: string; league: string }) {
    if (oddsSyncInFlightRef.current) return;

    oddsSyncInFlightRef.current = true;
    setSyncingOdds(true);
    setMatchesError(null);

    try {
      const leagues = args.league === "ALL" ? undefined : [String(args.league)];

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        setMatchesError("Brak sesji admina.");
        return;
      }

      const r = await fetch("/api/admin/manual-odds-sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          date: args.date,
          leagues,
          oddsTtlHours: 6,
          batchLimit: 30,
          throttleMs: 800,
          maxRetries: 2,
        }),
      });

      const text = await r.text().catch(() => "");
      let j: any = {};

      try {
        j = text ? JSON.parse(text) : {};
      } catch {
        j = { raw: text?.slice(0, 300) || "" };
      }

      if (!r.ok) {
        const msg =
          j?.error ||
          j?.message ||
          (typeof j?.raw === "string" && j.raw ? j.raw : "") ||
          `odds sync failed (HTTP ${r.status})`;

        setMatchesError(`Nie udało się zsynchronizować kursów: ${msg}`);
        return;
      }

      const rr = await fetch(
        `/api/events?date=${encodeURIComponent(selectedDate)}`,
        { cache: "no-store" }
      );

      const text2 = await rr.text();
      let payload: any = null;

      try {
        payload = JSON.parse(text2);
      } catch {
        payload = { error: text2?.slice(0, 300) || "Non-JSON response" };
      }

      if (!rr.ok) {
        const msg = payload?.error || `Błąd /api/events (HTTP ${rr.status})`;
        setMatchesError(msg);
        return;
      }

      const apiHorizonTo =
        typeof payload?.horizonTo === "string" ? payload.horizonTo : null;

      setHorizonYmd(apiHorizonTo);

      const apiSaysBeyond = Boolean(payload?.isBeyondHorizon);
      const uiSaysBeyond = isBeyondHorizonDay(selectedDate, apiHorizonTo);

      if (apiSaysBeyond || uiSaysBeyond) {
        matchesCacheRef.current[selectedDate] = [];
        horizonCacheRef.current[selectedDate] = apiHorizonTo;
        beyondCacheRef.current[selectedDate] = true;

        setBeyondHorizon(true);
        setMatches([]);
        setMatchesLoadedAt(new Date().toISOString());
        setMatchesError(null);

        await loadEnabledDates(selectedDate);
        return;
      }

      const baseMatches = sortMatches(
        buildMatchesFromPayload(payload, selectedDate),
        Date.now()
      );

      const { matches: hydratedMatches, latestOddsUpdatedAt } =
        await hydrateMatchesWithDbOdds(baseMatches);

      const loadedAt =
        latestOddsUpdatedAt ??
        (typeof payload?.updatedAt === "string"
          ? payload.updatedAt
          : new Date().toISOString());

      matchesCacheRef.current[selectedDate] = hydratedMatches;
      matchesLoadedAtCacheRef.current[selectedDate] = loadedAt;
      horizonCacheRef.current[selectedDate] = apiHorizonTo;
      beyondCacheRef.current[selectedDate] = false;

      setBeyondHorizon(false);
      setMatches(hydratedMatches);
      setMatchesLoadedAt(loadedAt);

      await loadEnabledDates(selectedDate);
    } finally {
      setSyncingOdds(false);
      oddsSyncInFlightRef.current = false;
    }
  }

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoadingMatches(true);
      setMatchesError(null);
      setBeyondHorizon(false);
      setHorizonYmd(null);

      const cachedMatches = matchesCacheRef.current[selectedDate];
      const cachedLoadedAt = matchesLoadedAtCacheRef.current[selectedDate];
      const cachedHorizon = horizonCacheRef.current[selectedDate];
      const cachedBeyond = beyondCacheRef.current[selectedDate];

      if (cachedMatches) {
        setMatches(cachedMatches);
        setMatchesLoadedAt(cachedLoadedAt ?? null);
        setHorizonYmd(cachedHorizon ?? null);
        setBeyondHorizon(Boolean(cachedBeyond));
        setLoadingMatches(false);
        return;
      }

      try {
        const r = await fetch(
          `/api/events?date=${encodeURIComponent(selectedDate)}`,
          { cache: "no-store" }
        );

        const text = await r.text();
        let payload: any = null;

        try {
          payload = JSON.parse(text);
        } catch {
          payload = { error: text?.slice(0, 300) || "Non-JSON response" };
        }

        if (!r.ok) {
          if (!cancelled) {
            setMatchesError(
              payload?.error || `Błąd /api/events (HTTP ${r.status})`
            );
          }
          return;
        }

        const apiHorizonTo =
          typeof payload?.horizonTo === "string" ? payload.horizonTo : null;

        if (!cancelled) setHorizonYmd(apiHorizonTo);

        const apiSaysBeyond = Boolean(payload?.isBeyondHorizon);
        const uiSaysBeyond = isBeyondHorizonDay(selectedDate, apiHorizonTo);

        if (apiSaysBeyond || uiSaysBeyond) {
          if (!cancelled) {
            matchesCacheRef.current[selectedDate] = [];
            horizonCacheRef.current[selectedDate] = apiHorizonTo;
            beyondCacheRef.current[selectedDate] = true;

            setBeyondHorizon(true);
            setMatches([]);
            setMatchesLoadedAt(new Date().toISOString());
            setMatchesError(null);
          }
          return;
        }

        const baseMatches = sortMatches(
          buildMatchesFromPayload(payload, selectedDate),
          Date.now()
        );

        const { matches: hydratedMatches, latestOddsUpdatedAt } =
          await hydrateMatchesWithDbOdds(baseMatches);

        const loadedAt =
          latestOddsUpdatedAt ??
          (typeof payload?.updatedAt === "string"
            ? payload.updatedAt
            : new Date().toISOString());

        if (!cancelled) {
          matchesCacheRef.current[selectedDate] = hydratedMatches;
          matchesLoadedAtCacheRef.current[selectedDate] = loadedAt;
          horizonCacheRef.current[selectedDate] = apiHorizonTo;
          beyondCacheRef.current[selectedDate] = false;

          setBeyondHorizon(false);
          setMatches(hydratedMatches);
          setMatchesLoadedAt(loadedAt);
        }
      } catch (e: any) {
        if (!cancelled) {
          setMatchesError(e?.message || "Nie udało się pobrać meczów.");
        }
      } finally {
        if (!cancelled) setLoadingMatches(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedDate, reloadKey]);

  useEffect(() => {
    let cancelled = false;

    const loadStandings = async () => {
      if (selectedLeague === "ALL") {
        setStandings(null);
        setStandingsError(null);
        setLoadingStandings(false);
        setSelectedTeamId(null);
        return;
      }

      setSelectedTeamId(null);
      setLoadingStandings(true);
      setStandingsError(null);

      try {
        const r = await fetch(
          `/api/standings?competitionCode=${encodeURIComponent(selectedLeague)}`,
          { cache: "no-store" }
        );

        const text = await r.text();
        let j: any = null;

        try {
          j = JSON.parse(text);
        } catch {
          j = { error: text?.slice(0, 300) || "Non-JSON response" };
        }

        if (!r.ok) {
          if (!cancelled) {
            setStandings(null);
            setStandingsError(
              j?.error || `Błąd /api/standings (HTTP ${r.status})`
            );
          }
          return;
        }

        const rows: StandingsRowUI[] = Array.isArray(j?.rows) ? j.rows : [];
        rows.sort((a, b) => Number(a.position) - Number(b.position));

        if (!cancelled) {
          setStandings({
            competitionCode: String(j?.competitionCode || selectedLeague),
            competitionName:
              String(j?.competitionName || "") ||
              FREE_TIER_LEAGUES.find((x) => x.code === selectedLeague)?.name ||
              selectedLeague,
            season: j?.season ? String(j.season) : null,
            rows,
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          setStandings(null);
          setStandingsError(e?.message || "Nie udało się pobrać tabeli.");
        }
      } finally {
        if (!cancelled) setLoadingStandings(false);
      }
    };

    void loadStandings();

    return () => {
      cancelled = true;
    };
  }, [selectedLeague]);

  const normalizedSearchQuery = useMemo(
    () => searchQuery.trim().toLowerCase(),
    [searchQuery]
  );

  const filteredMatches = useMemo(() => {
    const byLeague =
      selectedLeague === "ALL"
        ? matches
        : matches.filter((m) => m.competitionCode === selectedLeague);

    const bySearch = normalizedSearchQuery
      ? byLeague.filter((m) => {
          const haystack = [
            m.home,
            m.away,
            m.competitionName,
            m.competitionCode,
            m.status,
          ]
            .join(" ")
            .toLowerCase();

          return haystack.includes(normalizedSearchQuery);
        })
      : byLeague;

    return sortMatchesByMode(bySearch, nowMs, sortMode);
  }, [matches, selectedLeague, nowMs, normalizedSearchQuery, sortMode]);

  const liveMatches = useMemo(
    () => filteredMatches.filter((m) => m.isLive || isLiveStatus(m.status)),
    [filteredMatches]
  );

  const openMatches = useMemo(
    () =>
      filteredMatches.filter((m) => {
        if (m.isLive || isLiveStatus(m.status)) return false;
        if (m.isFinished || isFinishedStatus(m.status)) return false;
        return true;
      }),
    [filteredMatches]
  );

  const finishedMatches = useMemo(
    () =>
      filteredMatches.filter(
        (m) => m.isFinished || isFinishedStatus(m.status)
      ),
    [filteredMatches]
  );

  const matchesWithOddsCount = useMemo(
    () =>
      filteredMatches.filter(
        (m) =>
          typeof m.odds["1"] === "number" ||
          typeof m.odds.X === "number" ||
          typeof m.odds["2"] === "number"
      ).length,
    [filteredMatches]
  );

  const openSectionTitle =
    selectedDate === todayLocalYYYYMMDD() ? "Dziś" : "Zaplanowane";

  const featuredMatches = useMemo(() => {
    const source = [...liveMatches, ...openMatches];
    const seen = new Set<string>();

    return source
      .filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      })
      .slice(0, 3);
  }, [liveMatches, openMatches]);

  const leagueCounts = useMemo(() => {
    const map: Record<string, number> = { ALL: matches.length };

    for (const league of FREE_TIER_LEAGUES) {
      map[league.code] = matches.filter(
        (m) => m.competitionCode === league.code
      ).length;
    }

    return map;
  }, [matches]);

  const goMatch = (m: Match) => {
    const qs = new URLSearchParams();

    qs.set("c", m.competitionCode);
    if (m.homeId != null) qs.set("h", String(m.homeId));
    if (m.awayId != null) qs.set("a", String(m.awayId));
    qs.set("k", m.kickoffUtc);
    qs.set("hn", m.home);
    qs.set("an", m.away);

    router.push(`/events/${m.id}?${qs.toString()}`);
  };

  const selectedTeam = useMemo(() => {
    if (!standings?.rows?.length || selectedTeamId == null) return null;
    return standings.rows.find((r) => r.teamId === selectedTeamId) ?? null;
  }, [standings, selectedTeamId]);

  const selectedTeamInsights = useMemo(() => {
    if (!selectedTeam) return null;

    const pg = selectedTeam.playedGames || 0;
    const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

    const ppg = safeDiv(selectedTeam.points, pg);
    const gfpg = safeDiv(selectedTeam.goalsFor, pg);
    const gapg = safeDiv(selectedTeam.goalsAgainst, pg);

    const winRate = safeDiv(selectedTeam.won, pg) * 100;
    const drawRate = safeDiv(selectedTeam.draw, pg) * 100;
    const lossRate = safeDiv(selectedTeam.lost, pg) * 100;

    const raw = selectedTeam.form || "";
    const parts = raw
      ? (raw.includes(",")
          ? raw.split(",")
          : raw.includes("-")
            ? raw.split("-")
            : [raw]
        )
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];

    const todayMatch =
      matches.find(
        (m) =>
          m.homeId === selectedTeam.teamId || m.awayId === selectedTeam.teamId
      ) ?? null;

    return {
      ppg,
      gfpg,
      gapg,
      winRate,
      drawRate,
      lossRate,
      form5: parts,
      todayMatch,
    };
  }, [selectedTeam, matches]);

  const renderMarketButtons = (m: Match) => {
    const availability = getMatchAvailability(m, nowMs);

    return (
      <div
        className="grid grid-cols-3 gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {(["1", "X", "2"] as Pick[]).map((pick) => {
          const active = isActivePick(m.id, MARKET_ID_1X2, pick);

          const oddRaw = m.odds[pick];
          const hasOdd =
            typeof oddRaw === "number" &&
            Number.isFinite(oddRaw) &&
            oddRaw > 0;
          const odd = hasOdd ? oddRaw : 0;

          const disabled = !hasOdd || availability.closed;
          const title = !hasOdd
            ? "Brak kursu w bazie dla tego wyboru."
            : availability.closed
              ? availability.closedReason ?? "Zakłady są zamknięte."
              : active
                ? "Kliknij ponownie, aby usunąć typ z kuponu."
                : `Dodaj do kuponu. Kurs: ${formatOdd(odd)}`;

          return (
            <button
              key={pick}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;

                if (active) {
                  removeFromSlip(m.id, MARKET_ID_1X2);
                  return;
                }

                addToSlip({
                  matchId: m.id,
                  competitionCode: m.competitionCode,
                  league: m.competitionName,
                  home: m.home,
                  away: m.away,
                  market: MARKET_ID_1X2,
                  pick,
                  odd,
                  kickoffUtc: m.kickoffUtc,
                });
              }}
              className={cn(
                "group rounded-2xl border px-3 py-3 text-center transition",
                disabled
                  ? "cursor-not-allowed border-neutral-800 bg-neutral-950/70 text-neutral-600"
                  : active
                    ? "border-white bg-white text-black shadow-[0_10px_35px_rgba(255,255,255,0.12)]"
                    : "border-neutral-800 bg-neutral-950 text-white hover:border-neutral-600 hover:bg-neutral-900"
              )}
              title={title}
              aria-label={`${pickLabel(pick)} ${hasOdd ? formatOdd(odd) : "brak kursu"}`}
            >
              <div className="text-sm font-semibold leading-none">
                {shortPickLabel(pick)}
              </div>
              <div className="mt-1 text-[11px] opacity-70">{pickLabel(pick)}</div>
              <div className="mt-1 text-sm font-semibold">
                {hasOdd ? formatOdd(odd) : "—"}
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  const renderFeaturedMatchCard = (m: Match) => {
    const distance = formatKickoffDistance(m.kickoffUtc, nowMs);

    return (
      <button
        key={m.id}
        type="button"
        onClick={() => goMatch(m)}
        className="group w-full rounded-3xl border border-neutral-800 bg-gradient-to-b from-neutral-900/90 to-neutral-950/90 p-4 text-left transition hover:border-neutral-700 hover:from-neutral-900 hover:to-neutral-950"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SmallPill tone="blue">{m.competitionName}</SmallPill>
              <span className="text-xs text-neutral-500">{m.time}</span>
            </div>

            {distance ? (
              <div className="mt-2 text-xs text-neutral-500">{distance}</div>
            ) : null}
          </div>

          <div className="shrink-0">
            <MatchStatusPill match={m} nowMs={nowMs} />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <TeamNameLine
            name={m.home}
            score={m.homeScore}
            highlight={hasVisibleScore(m)}
          />
          <TeamNameLine
            name={m.away}
            score={m.awayScore}
            highlight={hasVisibleScore(m)}
          />
        </div>

        <div className="mt-4">{renderMarketButtons(m)}</div>

        <div className="mt-3 text-xs text-neutral-500 transition group-hover:text-neutral-300">
          Otwórz pełne rynki →
        </div>
      </button>
    );
  };

  const renderMatchCard = (m: Match) => {
    const distance = formatKickoffDistance(m.kickoffUtc, nowMs);

    return (
      <div
        key={m.id}
        role="button"
        tabIndex={0}
        onClick={() => goMatch(m)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            goMatch(m);
          }
        }}
        className="group cursor-pointer rounded-3xl border border-neutral-800 bg-neutral-950/70 p-4 transition hover:border-neutral-700 hover:bg-neutral-900/70"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SmallPill>{m.competitionName}</SmallPill>

              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[11px] font-semibold text-neutral-300">
                {formatLocalDateTime(m.kickoffUtc)}
              </span>

              <MatchStatusPill match={m} nowMs={nowMs} />

              {distance ? (
                <span className="text-xs text-neutral-500">{distance}</span>
              ) : null}
            </div>

            <div className="mt-4 grid gap-2">
              <TeamNameLine name={m.home} score={m.homeScore} />
              <TeamNameLine name={m.away} score={m.awayScore} />
            </div>

            <div className="mt-3 text-xs text-neutral-500 transition group-hover:text-neutral-300">
              Kliknij kartę, aby zobaczyć wszystkie rynki
            </div>
          </div>

          <div className="w-full lg:w-[360px]">{renderMarketButtons(m)}</div>
        </div>
      </div>
    );
  };

  const renderStandingsPanel = () => {
    if (selectedLeague === "ALL") {
      return (
        <EmptyStateCard
          title="Wybierz jedną ligę"
          description="Tabela jest dostępna po wybraniu konkretnej ligi. Dla widoku „Wszystkie ligi” pokazujemy tylko feed meczów."
        />
      );
    }

    if (loadingStandings) {
      return (
        <SurfaceCard className="p-6 text-neutral-300">
          Ładowanie tabeli…
        </SurfaceCard>
      );
    }

    if (standingsError) {
      return (
        <SurfaceCard className="border-red-500/20 bg-red-500/10 p-6 text-red-300">
          <div className="text-sm font-semibold">Nie udało się pobrać tabeli</div>
          <div className="mt-1 text-sm">{standingsError}</div>
        </SurfaceCard>
      );
    }

    if (!standings?.rows?.length) {
      return (
        <EmptyStateCard
          title="Brak tabeli dla tej ligi"
          description="Dane tabeli nie są jeszcze dostępne albo nie zostały zaimportowane dla wybranych rozgrywek."
        />
      );
    }

    return (
      <SurfaceCard className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xl font-semibold text-white">
              {standings.competitionName}
            </div>
            {standings.season ? (
              <div className="mt-1 text-xs text-neutral-400">
                Sezon: {standings.season}
              </div>
            ) : null}
          </div>

          <SmallPill>{standings.rows.length} drużyn</SmallPill>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-400">
                <th className="w-10 py-2 pr-2 text-left font-medium">#</th>
                <th className="py-2 pr-2 text-left font-medium">Drużyna</th>
                <th className="w-10 py-2 pl-2 text-right font-medium">M</th>
                <th className="w-10 py-2 pl-2 text-right font-medium">Z</th>
                <th className="w-10 py-2 pl-2 text-right font-medium">R</th>
                <th className="w-10 py-2 pl-2 text-right font-medium">P</th>
                <th className="w-12 py-2 pl-2 text-right font-medium">PKT</th>
                <th className="w-12 py-2 pl-2 text-right font-medium">RB</th>
                <th className="w-44 py-2 pl-2 text-left font-medium">Forma</th>
              </tr>
            </thead>

            <tbody>
              {standings.rows.map((r) => {
                const form = formatForm(r.form);

                return (
                  <tr
                    key={r.teamId}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTeamId(r.teamId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedTeamId(r.teamId);
                      }
                    }}
                    className={cn(
                      "cursor-pointer border-b border-neutral-800/60 transition",
                      selectedTeamId === r.teamId
                        ? "bg-white/[0.06]"
                        : "hover:bg-neutral-900/70"
                    )}
                  >
                    <td className="py-3 pr-2 text-neutral-300">{r.position}</td>
                    <td className="py-3 pr-2 font-medium text-neutral-100">
                      {r.teamName}
                    </td>
                    <td className="py-3 pl-2 text-right text-neutral-300">
                      {r.playedGames}
                    </td>
                    <td className="py-3 pl-2 text-right text-neutral-300">
                      {r.won}
                    </td>
                    <td className="py-3 pl-2 text-right text-neutral-300">
                      {r.draw}
                    </td>
                    <td className="py-3 pl-2 text-right text-neutral-300">
                      {r.lost}
                    </td>
                    <td className="py-3 pl-2 text-right font-semibold text-white">
                      {r.points}
                    </td>
                    <td className="py-3 pl-2 text-right text-neutral-300">
                      {r.goalDifference}
                    </td>
                    <td className="py-3 pl-2 text-neutral-300">
                      {form?.length ? (
                        <div className="flex gap-1">
                          {form.map((x, idx) => (
                            <span
                              key={`${r.teamId}-${idx}-${x}`}
                              className={cn(
                                "inline-flex h-6 w-6 items-center justify-center rounded-md border text-[11px] font-semibold",
                                x.toUpperCase() === "W"
                                  ? "border-green-500/30 bg-green-500/10 text-green-300"
                                  : x.toUpperCase() === "L"
                                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                                    : "border-neutral-800 bg-neutral-900 text-neutral-200"
                              )}
                            >
                              {x}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-neutral-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selectedTeam && selectedTeamInsights ? (
          <div className="mt-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-neutral-100">
                  {selectedTeam.position}. {selectedTeam.teamName}
                </div>
                <div className="mt-1 text-[11px] text-neutral-400">
                  M: {selectedTeam.playedGames} • Z: {selectedTeam.won} • R:{" "}
                  {selectedTeam.draw} • P: {selectedTeam.lost} • PKT:{" "}
                  {selectedTeam.points} • RB: {selectedTeam.goalDifference}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedTeamId(null)}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800"
              >
                Zamknij
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatMiniCard
                label="PPG"
                value={selectedTeamInsights.ppg.toFixed(2)}
              />
              <StatMiniCard
                label="Win / Draw / Loss"
                value={`${selectedTeamInsights.winRate.toFixed(0)}% / ${selectedTeamInsights.drawRate.toFixed(0)}% / ${selectedTeamInsights.lossRate.toFixed(0)}%`}
              />
              <StatMiniCard
                label="Gole / mecz"
                value={selectedTeamInsights.gfpg.toFixed(2)}
              />
              <StatMiniCard
                label="Stracone / mecz"
                value={selectedTeamInsights.gapg.toFixed(2)}
              />
            </div>

            {selectedTeamInsights.todayMatch ? (
              <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Mecz w wybranym dniu
                </div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {selectedTeamInsights.todayMatch.home}{" "}
                  <span className="font-normal text-neutral-500">vs</span>{" "}
                  {selectedTeamInsights.todayMatch.away} •{" "}
                  {selectedTeamInsights.todayMatch.time}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SurfaceCard>
    );
  };

  return (
    <div className="space-y-5">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.11),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.95),rgba(5,5,5,0.98))] p-5 sm:p-6">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Football
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Mecze, kursy i typy
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Bukmacherski feed spotkań z kursami 1X2, filtrowaniem lig,
                szybkim kuponem i kontrolą dostępności typowania.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatMiniCard
                  label="Mecze"
                  value={filteredMatches.length}
                  hint={selectedLeagueLabel}
                />
                <StatMiniCard
                  label="LIVE"
                  value={liveMatches.length}
                  tone={liveMatches.length > 0 ? "red" : "neutral"}
                />
                <StatMiniCard
                  label="Otwarte"
                  value={openMatches.length}
                  tone="green"
                />
                <StatMiniCard
                  label="Z kursami"
                  value={`${matchesWithOddsCount}/${filteredMatches.length}`}
                  hint="1X2"
                  tone="blue"
                />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <SmallPill>
                  Liga:{" "}
                  <span className="ml-1 font-semibold text-white">
                    {selectedLeagueLabel}
                  </span>
                </SmallPill>

                {matchesLoadedAt ? (
                  <SmallPill>
                    Aktualizacja:{" "}
                    {new Date(matchesLoadedAt).toLocaleTimeString("pl-PL", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </SmallPill>
                ) : null}

                {beyondHorizon ? (
                  <SmallPill tone="yellow">Poza horyzontem danych</SmallPill>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-3">
                <DayBar
                  value={selectedDate}
                  onChange={setSelectedDate}
                  enabledDates={enabledDates}
                  enabledDatesLoaded={enabledDatesLoaded}
                />
              </div>

              <button
                type="button"
                onClick={refreshCurrentDay}
                disabled={loadingMatches}
                className={cn(
                  "w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                  loadingMatches
                    ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-600"
                    : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:border-neutral-700 hover:bg-neutral-900"
                )}
              >
                {loadingMatches ? "Odświeżam…" : "Odśwież mecze"}
              </button>

              {!checkingAdmin && isAdmin ? (
                <button
                  type="button"
                  onClick={() =>
                    manualSyncOddsForDay({
                      date: selectedDate,
                      league: selectedLeague,
                    })
                  }
                  disabled={syncingOdds}
                  className={cn(
                    "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition",
                    syncingOdds
                      ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                      : "bg-white text-black hover:bg-neutral-200"
                  )}
                >
                  {syncingOdds ? "Synchronizuję kursy…" : "Synchronizuj kursy"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_220px_180px]">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Szukaj meczu, drużyny albo ligi
            </label>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="np. Arsenal, Serie A, Real..."
              className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-neutral-600"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Sortowanie
            </label>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-white outline-none focus:border-neutral-600"
            >
              <option value="smart">Smart: LIVE i najbliższe</option>
              <option value="time">Godzina meczu</option>
              <option value="league">Liga</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Widok
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setActiveRightTab("matches")}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                  activeRightTab === "matches"
                    ? "border-white bg-white text-black"
                    : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900"
                )}
              >
                Mecze
              </button>

              <button
                type="button"
                onClick={() => setActiveRightTab("table")}
                disabled={selectedLeague === "ALL"}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                  selectedLeague === "ALL"
                    ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-600"
                    : activeRightTab === "table"
                      ? "border-white bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900"
                )}
              >
                Tabela
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 pb-5 text-sm sm:px-5">
          {loadingMatches ? (
            <span className="text-neutral-400">Ładowanie meczów…</span>
          ) : matchesError ? (
            <span className="text-red-300">{matchesError}</span>
          ) : beyondHorizon ? (
            <span className="text-neutral-400">
              Jeszcze brak meczów, wkrótce się pojawią. Horyzont danych:{" "}
              <span className="font-semibold text-white">{horizonYmd ?? "—"}</span>
            </span>
          ) : (
            <span className="text-neutral-500">
              Wyświetlasz{" "}
              <span className="font-semibold text-white">
                {filteredMatches.length}
              </span>{" "}
              meczów dla filtra{" "}
              <span className="font-semibold text-white">
                {selectedLeagueLabel}
              </span>
              .
            </span>
          )}
        </div>
      </SurfaceCard>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <div className="sticky top-24 space-y-4">
            <SurfaceCard className="p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                Ligi i filtry
              </div>

              <div className="mt-3 text-2xl font-semibold text-white">
                Oferta dnia
              </div>

              <p className="mt-3 text-sm leading-6 text-neutral-400">
                Wybierz ligę, sprawdź liczbę spotkań i szybko przejdź do kursów
                1X2.
              </p>

              <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Wybrany dzień
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {selectedDate}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <SmallPill tone="red">LIVE {liveMatches.length}</SmallPill>
                  <SmallPill tone="green">Open {openMatches.length}</SmallPill>
                  <SmallPill>Finished {finishedMatches.length}</SmallPill>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <LeagueButton
                  active={selectedLeague === "ALL"}
                  label="Wszystkie ligi"
                  count={leagueCounts.ALL ?? 0}
                  onClick={() => {
                    setSelectedLeague("ALL");
                    setActiveRightTab("matches");
                  }}
                />

                {FREE_TIER_LEAGUES.map((lg) => (
                  <LeagueButton
                    key={lg.code}
                    active={selectedLeague === lg.code}
                    label={lg.name}
                    count={leagueCounts[lg.code] ?? 0}
                    onClick={() => {
                      setSelectedLeague(lg.code);
                      setActiveRightTab("matches");
                    }}
                  />
                ))}
              </div>
            </SurfaceCard>
          </div>
        </aside>

        <div className="min-w-0 space-y-5">
          <div className="overflow-x-auto pb-1 xl:hidden">
            <div className="flex w-max gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedLeague("ALL");
                  setActiveRightTab("matches");
                }}
                className={cn(
                  "flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                  selectedLeague === "ALL"
                    ? "border-white bg-white text-black"
                    : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
                )}
              >
                Wszystkie
                <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs">
                  {leagueCounts.ALL ?? 0}
                </span>
              </button>

              {FREE_TIER_LEAGUES.map((lg) => (
                <button
                  key={lg.code}
                  type="button"
                  onClick={() => {
                    setSelectedLeague(lg.code);
                    setActiveRightTab("matches");
                  }}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                    selectedLeague === lg.code
                      ? "border-white bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
                  )}
                >
                  {lg.name}
                  <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs">
                    {leagueCounts[lg.code] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {activeRightTab === "matches" ? (
            loadingMatches ? (
              <LoadingMatchesSkeleton />
            ) : matchesError ? (
              <SurfaceCard className="border-red-500/20 bg-red-500/10 p-6">
                <div className="text-sm font-semibold text-red-200">
                  Nie udało się pobrać meczów
                </div>
                <div className="mt-1 text-sm text-red-300">{matchesError}</div>
                <button
                  type="button"
                  onClick={refreshCurrentDay}
                  className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-200 transition hover:bg-neutral-900"
                >
                  Spróbuj ponownie
                </button>
              </SurfaceCard>
            ) : filteredMatches.length === 0 ? (
              <EmptyStateCard
                title={
                  beyondHorizon
                    ? "Mecze pojawią się później"
                    : "Brak meczów dla tego filtra"
                }
                description={
                  beyondHorizon ? (
                    <>
                      Dodajemy mecze z wyprzedzeniem. Obecny horyzont danych:{" "}
                      <span className="font-semibold text-white">
                        {horizonYmd ?? "—"}
                      </span>
                      .
                    </>
                  ) : normalizedSearchQuery ? (
                    <>
                      Nie znaleziono spotkań dla wyszukiwania{" "}
                      <span className="font-semibold text-white">
                        „{searchQuery.trim()}”
                      </span>
                      . Wyczyść wyszukiwarkę albo zmień ligę.
                    </>
                  ) : (
                    "Nie ma spotkań dla wybranego dnia lub ligi."
                  )
                }
                action={
                  normalizedSearchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-900"
                    >
                      Wyczyść wyszukiwanie
                    </button>
                  ) : null
                }
              />
            ) : (
              <div className="space-y-5">
                {featuredMatches.length > 0 ? (
                  <div className="space-y-3">
                    <SectionHeader
                      title="Najważniejsze mecze"
                      count={featuredMatches.length}
                      subtitle="Szybki dostęp do aktualnych i najbliższych spotkań."
                    />
                    <div className="grid gap-3 xl:grid-cols-3">
                      {featuredMatches.map((m) => renderFeaturedMatchCard(m))}
                    </div>
                  </div>
                ) : null}

                {liveMatches.length > 0 ? (
                  <div className="space-y-3">
                    <SectionHeader
                      title="LIVE"
                      count={liveMatches.length}
                      badgeClassName="border-red-500/30 bg-red-500/10 text-red-300"
                    />
                    <div className="space-y-3">
                      {liveMatches.map((m) => renderMatchCard(m))}
                    </div>
                  </div>
                ) : null}

                {openMatches.length > 0 ? (
                  <div className="space-y-3">
                    <SectionHeader
                      title={openSectionTitle}
                      count={openMatches.length}
                      subtitle="Zakłady zamykają się minutę przed startem meczu."
                    />
                    <div className="space-y-3">
                      {openMatches.map((m) => renderMatchCard(m))}
                    </div>
                  </div>
                ) : null}

                {finishedMatches.length > 0 ? (
                  <div className="space-y-3">
                    <SectionHeader
                      title="Zakończone"
                      count={finishedMatches.length}
                    />
                    <div className="space-y-3">
                      {finishedMatches.map((m) => renderMatchCard(m))}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          ) : (
            renderStandingsPanel()
          )}
        </div>
      </div>
    </div>
  );
}