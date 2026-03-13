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
    const competitionName =
      fixtures?.competition?.name ?? league?.name ?? code;

    const list = Array.isArray(fixtures?.matches) ? fixtures.matches : [];

    for (const m of list) {
      const utc = m?.utcDate;
      if (!utc) continue;

      const time = new Date(utc).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

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
          className={[
            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            badgeClassName ?? "border-neutral-800 bg-neutral-950 text-neutral-300",
          ].join(" ")}
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

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const [syncingOdds, setSyncingOdds] = useState(false);
  const oddsSyncInFlightRef = useRef(false);

  const matchesCacheRef = useRef<Record<string, Match[]>>({});
  const matchesLoadedAtCacheRef = useRef<Record<string, string | null>>({});
  const horizonCacheRef = useRef<Record<string, string | null>>({});
  const beyondCacheRef = useRef<Record<string, boolean>>({});

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

    checkBanned();

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

    checkAdmin();

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

    load();

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

    loadStandings();

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

  const renderMatchCard = (m: Match) => {
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
        className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 hover:bg-neutral-900/60 transition cursor-pointer"
      >
        <div className="text-xs text-neutral-400 flex items-center justify-between gap-2">
          <span>{m.leagueLine}</span>

          {live ? (
            <span className="text-[11px] px-2 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 font-semibold animate-pulse">
              LIVE
            </span>
          ) : finished ? (
            <span className="text-[11px] px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300">
              Zakończony
            </span>
          ) : closed ? (
            <span className="text-[11px] px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-950 text-amber-300">
              Mecz rozpoczęty • zakłady zamknięte
            </span>
          ) : (
            <span className="text-[11px] px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300">
              Pre-match
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-lg font-semibold">
            {m.home} <span className="text-neutral-400 font-normal">vs</span>{" "}
            {m.away}
          </div>

          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {!closed &&
              (["1", "X", "2"] as Pick[]).map((pick) => {
                const active = isActivePick(m.id, MARKET_ID_1X2, pick);

                const oddRaw = m.odds[pick];
                const hasOdd =
                  typeof oddRaw === "number" &&
                  Number.isFinite(oddRaw) &&
                  oddRaw > 0;
                const odd = hasOdd ? oddRaw : 0;

                return (
                  <button
                    key={pick}
                    disabled={!hasOdd}
                    onClick={() => {
                      if (!hasOdd) return;

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
                    className={[
                      "w-20 rounded-xl border px-3 py-2 text-sm transition",
                      !hasOdd
                        ? "border-neutral-800 bg-neutral-950 text-neutral-600 cursor-not-allowed"
                        : active
                          ? "border-neutral-200 bg-white text-black"
                          : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800",
                    ].join(" ")}
                    title={
                      hasOdd
                        ? `Kurs: ${formatOdd(odd)}`
                        : "Brak kursu w bazie (odds)"
                    }
                  >
                    <div className="leading-none font-semibold">{pick}</div>
                    <div className="text-[11px] opacity-80 mt-1">
                      {hasOdd ? formatOdd(odd) : "—"}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Mecze</h1>
            <p className="text-neutral-400 mt-1">
              Wybierz dzień i ligę — pokażemy mecze tylko z wybranego dnia.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <DayBar
              value={selectedDate}
              onChange={setSelectedDate}
              enabledDates={enabledDates}
              enabledDatesLoaded={enabledDatesLoaded}
            />

            <button
              onClick={refreshCurrentDay}
              disabled={loadingMatches}
              className={[
                "rounded-xl border px-3 py-2 text-sm transition",
                loadingMatches
                  ? "border-neutral-800 bg-neutral-950 text-neutral-600 cursor-not-allowed"
                  : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-800",
              ].join(" ")}
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
                className={[
                  "rounded-xl border px-3 py-2 text-sm transition",
                  syncingOdds
                    ? "border-neutral-800 bg-neutral-950 text-neutral-600 cursor-not-allowed"
                    : "border-neutral-200 bg-white text-black hover:opacity-90",
                ].join(" ")}
                title="Pomocniczo: uruchamia /api/odds/sync (normalnie robi to cron)"
              >
                {syncingOdds ? "Synchronizuję…" : "Synchronizuj kursy"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-neutral-300">
            Liga: <span className="font-semibold text-white">{selectedLeagueLabel}</span>
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
              Ostatnia aktualizacja: {new Date(matchesLoadedAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm">
          {loadingMatches ? (
            <span className="text-neutral-400">Ładowanie…</span>
          ) : matchesError ? (
            <span className="text-red-300">{matchesError}</span>
          ) : (
            <span className="text-neutral-400">
              Wyświetlasz:{" "}
              <span className="text-white font-semibold">{selectedLeagueLabel}</span>{" "}
              • {filteredMatches.length} meczów
            </span>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[170px_1fr] gap-6">
        <aside className="h-fit lg:sticky lg:top-24 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3">
          <div className="text-sm font-semibold">Ligi</div>

          <div className="mt-3">
            <button
              onClick={() => {
                setSelectedLeague("ALL");
                setActiveRightTab("matches");
              }}
              className={[
                "w-full rounded-xl border px-2 py-2 text-xs transition text-left",
                selectedLeague === "ALL"
                  ? "border-neutral-200 bg-white text-black"
                  : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800",
              ].join(" ")}
            >
              <div className="whitespace-nowrap">Wszystkie ligi</div>
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {FREE_TIER_LEAGUES.map((lg) => {
              const active = selectedLeague === lg.code;

              return (
                <button
                  key={lg.code}
                  onClick={() => {
                    setSelectedLeague(lg.code);
                    setActiveRightTab("matches");
                  }}
                  className={[
                    "w-full rounded-xl border px-2 py-2 text-xs transition text-left",
                    active
                      ? "border-neutral-200 bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800",
                  ].join(" ")}
                  title={lg.name}
                >
                  <div className="whitespace-nowrap">{lg.name}</div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="space-y-3">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveRightTab("matches")}
                className={[
                  "flex-1 rounded-xl border px-3 py-2 text-sm transition",
                  activeRightTab === "matches"
                    ? "border-neutral-200 bg-white text-black"
                    : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800",
                ].join(" ")}
              >
                Mecze
              </button>

              <button
                onClick={() => setActiveRightTab("table")}
                disabled={selectedLeague === "ALL"}
                className={[
                  "flex-1 rounded-xl border px-3 py-2 text-sm transition",
                  selectedLeague === "ALL"
                    ? "border-neutral-800 bg-neutral-950 text-neutral-600 cursor-not-allowed"
                    : activeRightTab === "table"
                      ? "border-neutral-200 bg-white text-black"
                      : "border-neutral-800 bg-neutral-950 hover:bg-neutral-800",
                ].join(" ")}
                title={
                  selectedLeague === "ALL"
                    ? "Wybierz ligę, żeby zobaczyć tabelę"
                    : ""
                }
              >
                Tabela
              </button>
            </div>

            <div className="mt-2 text-xs text-neutral-400">
              {selectedLeague === "ALL"
                ? "Wyświetlasz mecze ze wszystkich lig. Tabela dostępna po wybraniu ligi."
                : `Liga: ${selectedLeagueLabel}`}
            </div>
          </div>

          {activeRightTab === "matches" ? (
            loadingMatches ? (
              <LoadingMatchesSkeleton />
            ) : matchesError ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6">
                <div className="text-sm font-medium text-red-200">Nie udało się pobrać meczów</div>
                <div className="mt-1 text-sm text-red-300">{matchesError}</div>
                <button
                  onClick={refreshCurrentDay}
                  className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 transition hover:bg-neutral-900"
                >
                  Spróbuj ponownie
                </button>
              </div>
            ) : filteredMatches.length === 0 ? (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-300">
                {beyondHorizon
                  ? "Jeszcze brak meczów, wkrótce się pojawią 🙂 Dodajemy mecze na 2 tygodnie do przodu."
                  : "Brak meczów dla wybranego dnia lub filtra ligi."}

                {beyondHorizon && horizonYmd ? (
                  <div className="text-xs text-neutral-500 mt-2">
                    Horyzont danych: do {horizonYmd} (UTC)
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
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
                      badgeClassName="border-neutral-800 bg-neutral-950 text-neutral-300"
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
                      badgeClassName="border-neutral-800 bg-neutral-950 text-neutral-300"
                    />
                    <div className="space-y-3">
                      {finishedMatches.map((m) => renderMatchCard(m))}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {activeRightTab === "table" ? (
            selectedLeague === "ALL" ? (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-300">
                Wybierz ligę po lewej stronie, aby zobaczyć tabelę.
              </div>
            ) : loadingStandings ? (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-300">
                Ładowanie tabeli…
              </div>
            ) : standingsError ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-300">
                {standingsError}
              </div>
            ) : standings?.rows?.length ? (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">
                      {standings.competitionName}
                    </div>
                    {standings.season ? (
                      <div className="text-xs text-neutral-400 mt-1">
                        Sezon: {standings.season}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-xs text-neutral-500">Tabela</div>
                </div>

                <div className="mt-3 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-neutral-400 border-b border-neutral-800">
                        <th className="text-left font-medium py-2 pr-2 w-10">#</th>
                        <th className="text-left font-medium py-2 pr-2">Drużyna</th>
                        <th className="text-right font-medium py-2 pl-2 w-10">M</th>
                        <th className="text-right font-medium py-2 pl-2 w-10">Z</th>
                        <th className="text-right font-medium py-2 pl-2 w-10">R</th>
                        <th className="text-right font-medium py-2 pl-2 w-10">P</th>
                        <th className="text-right font-medium py-2 pl-2 w-12">PKT</th>
                        <th className="text-right font-medium py-2 pl-2 w-12">RB</th>
                        <th className="text-left font-medium py-2 pl-2 w-44">Forma</th>
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
                            className={[
                              "border-b border-neutral-800/60 cursor-pointer transition",
                              selectedTeamId === r.teamId
                                ? "bg-neutral-900/60"
                                : "hover:bg-neutral-900/40",
                            ].join(" ")}
                          >
                            <td className="py-2 pr-2 text-neutral-300">{r.position}</td>
                            <td className="py-2 pr-2 text-neutral-200">{r.teamName}</td>
                            <td className="py-2 pl-2 text-right text-neutral-300">{r.playedGames}</td>
                            <td className="py-2 pl-2 text-right text-neutral-300">{r.won}</td>
                            <td className="py-2 pl-2 text-right text-neutral-300">{r.draw}</td>
                            <td className="py-2 pl-2 text-right text-neutral-300">{r.lost}</td>
                            <td className="py-2 pl-2 text-right text-neutral-100 font-semibold">{r.points}</td>
                            <td className="py-2 pl-2 text-right text-neutral-300">{r.goalDifference}</td>
                            <td className="py-2 pl-2 text-neutral-300">
                              {form?.length ? (
                                <div className="flex gap-1">
                                  {form.map((x, idx) => (
                                    <span
                                      key={`${r.teamId}-${idx}-${x}`}
                                      className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-neutral-800 bg-neutral-900 text-[11px] text-neutral-200"
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

                {selectedTeam && selectedTeamInsights ? (
                  <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-neutral-100">
                          {selectedTeam.position}. {selectedTeam.teamName}
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-1">
                          M: {selectedTeam.playedGames} • Z: {selectedTeam.won} •
                          R: {selectedTeam.draw} • P: {selectedTeam.lost} • PKT:{" "}
                          {selectedTeam.points} • RB: {selectedTeam.goalDifference}
                        </div>
                      </div>

                      <button
                        onClick={() => setSelectedTeamId(null)}
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 transition"
                      >
                        Zamknij
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-2">
                        <div className="text-[11px] text-neutral-400">PPG</div>
                        <div className="text-sm font-semibold">
                          {selectedTeamInsights.ppg.toFixed(2)}
                        </div>
                      </div>

                      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-2">
                        <div className="text-[11px] text-neutral-400">Win/Draw/Loss</div>
                        <div className="text-sm font-semibold">
                          {selectedTeamInsights.winRate.toFixed(0)}% /{" "}
                          {selectedTeamInsights.drawRate.toFixed(0)}% /{" "}
                          {selectedTeamInsights.lossRate.toFixed(0)}%
                        </div>
                      </div>

                      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-2">
                        <div className="text-[11px] text-neutral-400">
                          Gole strzelone / mecz
                        </div>
                        <div className="text-sm font-semibold">
                          {selectedTeamInsights.gfpg.toFixed(2)}
                        </div>
                      </div>

                      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-2">
                        <div className="text-[11px] text-neutral-400">
                          Gole stracone / mecz
                        </div>
                        <div className="text-sm font-semibold">
                          {selectedTeamInsights.gapg.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    {selectedTeamInsights.todayMatch ? (
                      <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-2">
                        <div className="text-[11px] text-neutral-400">
                          Mecz w wybranym dniu
                        </div>
                        <div className="text-sm font-semibold mt-0.5">
                          {selectedTeamInsights.todayMatch.home}{" "}
                          <span className="text-neutral-400 font-normal">vs</span>{" "}
                          {selectedTeamInsights.todayMatch.away} •{" "}
                          {selectedTeamInsights.todayMatch.time}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-300">
                Brak danych tabeli dla tej ligi.
              </div>
            )
          ) : null}
        </section>
      </div>
    </div>
  );
}