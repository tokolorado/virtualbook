// app/(main)/events/page.tsx
"use client";

import { formatOdd } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import DayBar from "@/components/DayBar";
import { todayLocalYYYYMMDD, localDateKeyFromISO } from "@/lib/date";
import { useBetSlip } from "@/lib/BetSlipContext";

type Pick = "1" | "X" | "2";

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

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function safeNum(v: unknown): number | null {
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
  if (isLiveStatus(m.status)) return 0;

  const kickoff = Date.parse(m.kickoffUtc);
  if (!Number.isFinite(kickoff)) return 3;

  if (kickoff > nowMs) return 1;

  if (isFinishedStatus(m.status)) return 3;

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

    return a.competitionName.localeCompare(b.competitionName);
  });
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

      const time = new Date(utc).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const homeId = typeof m?.homeTeam?.id === "number" ? m.homeTeam.id : null;
      const awayId = typeof m?.awayTeam?.id === "number" ? m.awayTeam.id : null;

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

function SectionHeader({
  title,
  count,
  badgeClassName,
}: {
  title: string;
  count: number;
  badgeClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-100">{title}</h3>
        <span
          className={cx(
            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            badgeClassName ?? "border-neutral-800 bg-neutral-950 text-neutral-300"
          )}
        >
          {count}
        </span>
      </div>
    </div>
  );
}

function LoadingMatchesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="h-3 w-40 rounded bg-neutral-800" />
            <div className="h-6 w-24 rounded-full bg-neutral-800" />
          </div>

          <div className="mt-4 h-6 w-64 rounded bg-neutral-800" />

          <div className="mt-4 flex gap-2">
            <div className="h-12 w-20 rounded-xl bg-neutral-800" />
            <div className="h-12 w-20 rounded-xl bg-neutral-800" />
            <div className="h-12 w-20 rounded-xl bg-neutral-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LeagueRailButton({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "w-full rounded-2xl border px-3 py-3 text-left transition",
        active
          ? "border-white/15 bg-white/[0.08] text-white"
          : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium">{label}</span>
        {typeof count === "number" ? (
          <span
            className={cx(
              "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              active
                ? "border-white/15 bg-black/20 text-white"
                : "border-neutral-800 bg-black/20 text-neutral-400"
            )}
          >
            {count}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function SegmentedButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex-1 rounded-2xl border px-4 py-2.5 text-sm font-medium transition",
        disabled
          ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-600"
          : active
            ? "border-white/15 bg-white text-black"
            : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
      )}
    >
      {children}
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
        // ignore
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

      const rr = await fetch(`/api/events?date=${encodeURIComponent(selectedDate)}`, {
        cache: "no-store",
      });

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
        const r = await fetch(`/api/events?date=${encodeURIComponent(selectedDate)}`, {
          cache: "no-store",
        });

        const text = await r.text();
        let payload: any = null;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { error: text?.slice(0, 300) || "Non-JSON response" };
        }

        if (!r.ok) {
          if (!cancelled) {
            setMatchesError(payload?.error || `Błąd /api/events (HTTP ${r.status})`);
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
            setStandingsError(j?.error || `Błąd /api/standings (HTTP ${r.status})`);
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

  const filteredMatches = useMemo(() => {
    const base =
      selectedLeague === "ALL"
        ? matches
        : matches.filter((m) => m.competitionCode === selectedLeague);

    return sortMatches(base, nowMs);
  }, [matches, selectedLeague, nowMs]);

  const liveMatches = useMemo(
    () => filteredMatches.filter((m) => isLiveStatus(m.status)),
    [filteredMatches]
  );

  const openMatches = useMemo(
    () =>
      filteredMatches.filter((m) => {
        if (isLiveStatus(m.status)) return false;
        if (isFinishedStatus(m.status)) return false;
        return true;
      }),
    [filteredMatches]
  );

  const finishedMatches = useMemo(
    () => filteredMatches.filter((m) => isFinishedStatus(m.status)),
    [filteredMatches]
  );

  const featuredMatches = useMemo(() => {
    const seen = new Set<string>();
    const result: Match[] = [];

    for (const source of [liveMatches, openMatches]) {
      for (const m of source) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        result.push(m);
        if (result.length >= 6) return result;
      }
    }

    return result;
  }, [liveMatches, openMatches]);

  const leagueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const match of matches) {
      counts.set(
        match.competitionCode,
        (counts.get(match.competitionCode) ?? 0) + 1
      );
    }
    return counts;
  }, [matches]);

  const openSectionTitle =
    selectedDate === todayLocalYYYYMMDD() ? "Dziś" : "Zaplanowane";

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

  const renderOddButton = (
    m: Match,
    pick: Pick,
    compact = false
  ) => {
    const live = isLiveStatus(m.status);
    const finished = isFinishedStatus(m.status);
    const closed = live || finished || isBettingClosed(m.kickoffUtc, nowMs);
    const active = isActivePick(m.id, MARKET_ID_1X2, pick);

    const oddRaw = m.odds[pick];
    const hasOdd =
      typeof oddRaw === "number" && Number.isFinite(oddRaw) && oddRaw > 0;
    const odd = hasOdd ? oddRaw : 0;

    return (
      <button
        key={pick}
        disabled={!hasOdd || closed}
        onClick={(e) => {
          e.stopPropagation();
          if (!hasOdd || closed) return;

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
        className={cx(
          compact ? "w-full min-w-0" : "w-20",
          "rounded-xl border px-3 py-2 text-sm transition",
          !hasOdd || closed
            ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-600"
            : active
              ? "border-neutral-200 bg-white text-black"
              : "border-neutral-800 bg-neutral-950 text-white hover:bg-neutral-800"
        )}
        title={
          !hasOdd
            ? "Brak kursu w bazie (odds)"
            : closed
              ? "Zakłady zamknięte dla tego meczu"
              : `Kurs: ${formatOdd(odd)}`
        }
      >
        <div className="leading-none font-semibold">{pick}</div>
        <div className="mt-1 text-[11px] opacity-80">
          {hasOdd ? formatOdd(odd) : "—"}
        </div>
      </button>
    );
  };

  const renderMatchState = (m: Match) => {
    const live = isLiveStatus(m.status);
    const finished = isFinishedStatus(m.status);
    const closed = live || finished || isBettingClosed(m.kickoffUtc, nowMs);

    if (live) {
      return (
        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-300">
          LIVE
        </span>
      );
    }

    if (finished) {
      return (
        <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[11px] text-neutral-300">
          Zakończony
        </span>
      );
    }

    if (closed) {
      return (
        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-300">
          Zakłady zamknięte
        </span>
      );
    }

    return (
      <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[11px] text-neutral-300">
        Pre-match
      </span>
    );
  };

  const renderFeaturedCard = (m: Match) => {
    return (
      <div
        key={`featured-${m.id}`}
        role="button"
        tabIndex={0}
        onClick={() => goMatch(m)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            goMatch(m);
          }
        }}
        className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4 transition hover:bg-neutral-900/60 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-neutral-400">{m.competitionName}</div>
            <div className="mt-1 text-sm text-neutral-500">{m.time}</div>
          </div>

          <div className="shrink-0">{renderMatchState(m)}</div>
        </div>

        <div className="mt-4 min-h-[56px]">
          <div className="text-base font-semibold text-white">{m.home}</div>
          <div className="mt-1 text-base font-semibold text-white">{m.away}</div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {(["1", "X", "2"] as Pick[]).map((pick) =>
            renderOddButton(m, pick, true)
          )}
        </div>
      </div>
    );
  };

  const renderMatchRowCard = (m: Match) => {
    const live = isLiveStatus(m.status);
    const finished = isFinishedStatus(m.status);
    const closed = live || finished || isBettingClosed(m.kickoffUtc, nowMs);

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
        className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4 transition hover:bg-neutral-900/60 cursor-pointer"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-neutral-400">{m.leagueLine}</span>
              {renderMatchState(m)}
            </div>

            <div className="mt-3 text-lg font-semibold text-white">
              {m.home} <span className="font-normal text-neutral-400">vs</span>{" "}
              {m.away}
            </div>
          </div>

          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {(["1", "X", "2"] as Pick[]).map((pick) => renderOddButton(m, pick))}
          </div>
        </div>

        {closed && !live && !finished ? (
          <div className="mt-3 text-xs text-amber-300">
            Mecz rozpoczęty — zakłady są już zamknięte.
          </div>
        ) : null}
      </div>
    );
  };

  const renderTableView = () => {
    if (selectedLeague === "ALL") {
      return (
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-300">
          Wybierz ligę po lewej stronie, aby zobaczyć tabelę.
        </div>
      );
    }

    if (loadingStandings) {
      return (
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-300">
          Ładowanie tabeli…
        </div>
      );
    }

    if (standingsError) {
      return (
        <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-6 text-red-300">
          {standingsError}
        </div>
      );
    }

    if (!standings?.rows?.length) {
      return (
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-300">
          Brak danych tabeli dla tej ligi.
        </div>
      );
    }

    return (
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-lg font-semibold text-white">
                {standings.competitionName}
              </div>
              {standings.season ? (
                <div className="mt-1 text-xs text-neutral-400">
                  Sezon: {standings.season}
                </div>
              ) : null}
            </div>

            <div className="text-xs text-neutral-500">Tabela ligowa</div>
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
                      className={cx(
                        "border-b border-neutral-800/60 cursor-pointer transition",
                        selectedTeamId === r.teamId
                          ? "bg-neutral-900/60"
                          : "hover:bg-neutral-900/40"
                      )}
                    >
                      <td className="py-2 pr-2 text-neutral-300">{r.position}</td>
                      <td className="py-2 pr-2 text-neutral-200">{r.teamName}</td>
                      <td className="py-2 pl-2 text-right text-neutral-300">
                        {r.playedGames}
                      </td>
                      <td className="py-2 pl-2 text-right text-neutral-300">
                        {r.won}
                      </td>
                      <td className="py-2 pl-2 text-right text-neutral-300">
                        {r.draw}
                      </td>
                      <td className="py-2 pl-2 text-right text-neutral-300">
                        {r.lost}
                      </td>
                      <td className="py-2 pl-2 text-right font-semibold text-neutral-100">
                        {r.points}
                      </td>
                      <td className="py-2 pl-2 text-right text-neutral-300">
                        {r.goalDifference}
                      </td>
                      <td className="py-2 pl-2 text-neutral-300">
                        {form?.length ? (
                          <div className="flex gap-1">
                            {form.map((x, idx) => (
                              <span
                                key={`${r.teamId}-${idx}-${x}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-[11px] text-neutral-200"
                                title={
                                  x === "W"
                                    ? "Win"
                                    : x === "D"
                                      ? "Draw"
                                      : x === "L"
                                        ? "Loss"
                                        : x
                                }
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
        </div>

        <div className="space-y-4">
          {!selectedTeam || !selectedTeamInsights ? (
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="text-sm font-semibold text-white">
                Insight drużyny
              </div>
              <div className="mt-2 text-sm text-neutral-400">
                Kliknij drużynę w tabeli, aby zobaczyć szybkie podsumowanie formy.
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-white">
                    {selectedTeam.position}. {selectedTeam.teamName}
                  </div>
                  <div className="mt-1 text-xs text-neutral-400">
                    M: {selectedTeam.playedGames} • Z: {selectedTeam.won} • R:{" "}
                    {selectedTeam.draw} • P: {selectedTeam.lost}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedTeamId(null)}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800"
                >
                  Zamknij
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    PPG
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {selectedTeamInsights.ppg.toFixed(2)}
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Win rate
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {selectedTeamInsights.winRate.toFixed(0)}%
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Gole / mecz
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {selectedTeamInsights.gfpg.toFixed(2)}
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Stracone / mecz
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {selectedTeamInsights.gapg.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                  Bilans
                </div>
                <div className="mt-2 text-sm text-white">
                  {selectedTeamInsights.winRate.toFixed(0)}% /{" "}
                  {selectedTeamInsights.drawRate.toFixed(0)}% /{" "}
                  {selectedTeamInsights.lossRate.toFixed(0)}%
                </div>
              </div>

              {selectedTeamInsights.todayMatch ? (
                <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Mecz w wybranym dniu
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {selectedTeamInsights.todayMatch.home}{" "}
                    <span className="font-normal text-neutral-400">vs</span>{" "}
                    {selectedTeamInsights.todayMatch.away}
                  </div>
                  <div className="mt-1 text-xs text-neutral-400">
                    {selectedTeamInsights.todayMatch.time}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div className="max-w-3xl">
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                VirtualBook Football
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Mecze i kursy 1X2
              </h1>
              <p className="mt-2 text-sm leading-6 text-neutral-400">
                Przegląd wybranego dnia, szybki wybór ligi, wyróżnione mecze i
                pełna lista spotkań z aktualnymi kursami z bazy.
              </p>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center">
              <DayBar
                value={selectedDate}
                onChange={setSelectedDate}
                enabledDates={enabledDates}
                enabledDatesLoaded={enabledDatesLoaded}
              />

              <button
                onClick={refreshCurrentDay}
                disabled={loadingMatches}
                className={cx(
                  "rounded-2xl border px-4 py-3 text-sm transition",
                  loadingMatches
                    ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-600"
                    : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-800"
                )}
                title="Odśwież listę meczów dla wybranego dnia"
              >
                {loadingMatches ? "Odświeżam…" : "Odśwież mecze"}
              </button>

              {!checkingAdmin && isAdmin ? (
                <button
                  onClick={() =>
                    manualSyncOddsForDay({
                      date: selectedDate,
                      league: selectedLeague,
                    })
                  }
                  disabled={syncingOdds}
                  className={cx(
                    "rounded-2xl border px-4 py-3 text-sm transition",
                    syncingOdds
                      ? "cursor-not-allowed border-neutral-800 bg-neutral-950 text-neutral-600"
                      : "border-neutral-200 bg-white text-black hover:opacity-90"
                  )}
                  title="Pomocniczo: uruchamia /api/odds/sync (normalnie robi to cron)"
                >
                  {syncingOdds ? "Synchronizuję…" : "Synchronizuj kursy"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-neutral-300">
              Liga:{" "}
              <span className="font-semibold text-white">{selectedLeagueLabel}</span>
            </span>

            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-red-300">
              LIVE: {liveMatches.length}
            </span>

            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-neutral-300">
              {openSectionTitle}: {openMatches.length}
            </span>

            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-neutral-300">
              Zakończone: {finishedMatches.length}
            </span>

            {matchesLoadedAt ? (
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-neutral-500">
                Ostatnia aktualizacja:{" "}
                {new Date(matchesLoadedAt).toLocaleTimeString()}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-neutral-400">
              {loadingMatches ? (
                <span>Ładowanie…</span>
              ) : matchesError ? (
                <span className="text-red-300">{matchesError}</span>
              ) : (
                <span>
                  Wyświetlasz:{" "}
                  <span className="font-semibold text-white">
                    {selectedLeagueLabel}
                  </span>{" "}
                  • {filteredMatches.length} meczów
                </span>
              )}
            </div>

            {beyondHorizon && horizonYmd ? (
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-500">
                Horyzont danych: do {horizonYmd} (UTC)
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <div className="sticky top-24 max-h-[calc(100dvh-110px)] overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900/40">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-neutral-800 p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                  Discover
                </div>
                <div className="mt-2 text-lg font-semibold text-white">
                  Ligi i filtry
                </div>
                <div className="mt-1 text-sm text-neutral-400">
                  Odkrywaj mecze dla wybranego dnia bez przewijania całego feedu.
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Wybrany dzień
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">
                    {selectedDate}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-neutral-800 bg-black/20 px-2.5 py-1 text-neutral-300">
                      LIVE {liveMatches.length}
                    </span>
                    <span className="rounded-full border border-neutral-800 bg-black/20 px-2.5 py-1 text-neutral-300">
                      Open {openMatches.length}
                    </span>
                    <span className="rounded-full border border-neutral-800 bg-black/20 px-2.5 py-1 text-neutral-300">
                      Finished {finishedMatches.length}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Liga
                  </div>

                  <LeagueRailButton
                    label="Wszystkie ligi"
                    count={matches.length}
                    active={selectedLeague === "ALL"}
                    onClick={() => {
                      setSelectedLeague("ALL");
                      setActiveRightTab("matches");
                    }}
                  />

                  {FREE_TIER_LEAGUES.map((lg) => (
                    <LeagueRailButton
                      key={lg.code}
                      label={lg.name}
                      count={leagueCounts.get(lg.code) ?? 0}
                      active={selectedLeague === lg.code}
                      onClick={() => {
                        setSelectedLeague(lg.code);
                        setActiveRightTab("matches");
                      }}
                    />
                  ))}
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Tryb widoku
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <SegmentedButton
                      active={activeRightTab === "matches"}
                      onClick={() => setActiveRightTab("matches")}
                    >
                      Mecze
                    </SegmentedButton>

                    <SegmentedButton
                      active={activeRightTab === "table"}
                      disabled={selectedLeague === "ALL"}
                      onClick={() => setActiveRightTab("table")}
                    >
                      Tabela
                    </SegmentedButton>
                  </div>

                  <div className="mt-3 text-xs text-neutral-500">
                    {selectedLeague === "ALL"
                      ? "Tabela jest dostępna po wyborze konkretnej ligi."
                      : `Tabela dla: ${selectedLeagueLabel}`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-6">
          <div className="xl:hidden">
            <div className="overflow-x-auto pb-1">
              <div className="flex gap-2">
                <LeagueRailButton
                  label="Wszystkie"
                  count={matches.length}
                  active={selectedLeague === "ALL"}
                  onClick={() => {
                    setSelectedLeague("ALL");
                    setActiveRightTab("matches");
                  }}
                />

                {FREE_TIER_LEAGUES.map((lg) => (
                  <button
                    key={lg.code}
                    onClick={() => {
                      setSelectedLeague(lg.code);
                      setActiveRightTab("matches");
                    }}
                    className={cx(
                      "shrink-0 rounded-2xl border px-4 py-3 text-sm transition",
                      selectedLeague === lg.code
                        ? "border-white/15 bg-white text-black"
                        : "border-neutral-800 bg-neutral-950 text-neutral-300"
                    )}
                  >
                    {lg.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-lg font-semibold text-white">
                  Feed dnia
                </div>
                <div className="mt-1 text-sm text-neutral-400">
                  Najważniejsze mecze, pełna lista spotkań i tabela wybranej ligi.
                </div>
              </div>

              <div className="flex gap-2">
                <SegmentedButton
                  active={activeRightTab === "matches"}
                  onClick={() => setActiveRightTab("matches")}
                >
                  Mecze
                </SegmentedButton>

                <SegmentedButton
                  active={activeRightTab === "table"}
                  disabled={selectedLeague === "ALL"}
                  onClick={() => setActiveRightTab("table")}
                >
                  Tabela
                </SegmentedButton>
              </div>
            </div>
          </div>

          {activeRightTab === "matches" ? (
            loadingMatches ? (
              <LoadingMatchesSkeleton />
            ) : matchesError ? (
              <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-6">
                <div className="text-sm font-medium text-red-200">
                  Nie udało się pobrać meczów
                </div>
                <div className="mt-1 text-sm text-red-300">{matchesError}</div>
                <button
                  onClick={refreshCurrentDay}
                  className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
                >
                  Spróbuj ponownie
                </button>
              </div>
            ) : filteredMatches.length === 0 ? (
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-300">
                {beyondHorizon
                  ? "Jeszcze brak meczów, wkrótce się pojawią 🙂 Dodajemy mecze na 2 tygodnie do przodu."
                  : "Brak meczów dla wybranego dnia lub filtra ligi."}

                {beyondHorizon && horizonYmd ? (
                  <div className="mt-2 text-xs text-neutral-500">
                    Horyzont danych: do {horizonYmd} (UTC)
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-6">
                {featuredMatches.length > 0 ? (
                  <section className="space-y-3">
                    <SectionHeader
                      title="Najważniejsze mecze"
                      count={featuredMatches.length}
                      badgeClassName="border-neutral-800 bg-neutral-950 text-neutral-300"
                    />
                    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                      {featuredMatches.map((m) => renderFeaturedCard(m))}
                    </div>
                  </section>
                ) : null}

                {liveMatches.length > 0 ? (
                  <section className="space-y-3">
                    <SectionHeader
                      title="LIVE"
                      count={liveMatches.length}
                      badgeClassName="border-red-500/30 bg-red-500/10 text-red-300"
                    />
                    <div className="space-y-3">
                      {liveMatches.map((m) => renderMatchRowCard(m))}
                    </div>
                  </section>
                ) : null}

                {openMatches.length > 0 ? (
                  <section className="space-y-3">
                    <SectionHeader
                      title={openSectionTitle}
                      count={openMatches.length}
                      badgeClassName="border-neutral-800 bg-neutral-950 text-neutral-300"
                    />
                    <div className="space-y-3">
                      {openMatches.map((m) => renderMatchRowCard(m))}
                    </div>
                  </section>
                ) : null}

                {finishedMatches.length > 0 ? (
                  <section className="space-y-3">
                    <SectionHeader
                      title="Zakończone"
                      count={finishedMatches.length}
                      badgeClassName="border-neutral-800 bg-neutral-950 text-neutral-300"
                    />
                    <div className="space-y-3">
                      {finishedMatches.map((m) => renderMatchRowCard(m))}
                    </div>
                  </section>
                ) : null}
              </div>
            )
          ) : null}

          {activeRightTab === "table" ? renderTableView() : null}
        </section>
      </div>
    </div>
  );
}