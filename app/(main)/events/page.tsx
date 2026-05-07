// app/(main)/events/page.tsx
"use client";

import type { ReactNode } from "react";
import { formatOdd } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import DayBar from "@/components/DayBar";
import { LeagueIcon } from "@/components/LeagueIcon";
import { todayLocalYYYYMMDD, localDateKeyFromISO } from "@/lib/date";
import { useBetSlip } from "@/lib/BetSlipContext";

type Pick = "1" | "X" | "2";
type SortMode = "smart" | "time" | "league";

type MatchPrediction = {
  source: string | null;
  market: string | null;
  predictedScore: string | null;
  predictedHomeScore: number | null;
  predictedAwayScore: number | null;
  predictedResult: string | null;
  predictedLabel: string | null;
  scoreSource: "bsd_prediction" | "model_snapshot" | null;
  scoreProbability: number | null;
  expectedHomeGoals: number | null;
  expectedAwayGoals: number | null;
  probabilities: {
    homeWin: number | null;
    draw: number | null;
    awayWin: number | null;
    over15: number | null;
    over25: number | null;
    over35: number | null;
    bttsYes: number | null;
  };
  confidence: number | null;
  modelVersion: string | null;
  matchConfidence: string | null;
  matchScore: number | null;
  sourcePredictionId: string | null;
  sourceEventId: string | null;
  updatedAt: string | null;
};

type MatchDataQuality = {
  score: number;
  label: string;
  hasRealBsdOdds: boolean;
  hasModelOdds: boolean;
  hasBsdPrediction: boolean;
  hasBsdFeatures: boolean;
  hasModelScore: boolean;
  sourceBadges: string[];
  missing: string[];
  updatedAt: string | null;
};

type Match = {
  id: string;
  competitionCode: string;
  competitionName: string;
  leagueLine: string;
  homeId: number | null;
  awayId: number | null;
  homeCrest: string | null;
  awayCrest: string | null;
  home: string;
  away: string;
  time: string;
  kickoffUtc: string;
  status: string;
  isLive: boolean;
  isFinished: boolean;
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
  injuryTime: number | null;
  odds: { "1": number | null; X: number | null; "2": number | null };
  oddsMeta: {
    source: string | null;
    pricingMethod: string | null;
    isModel: boolean;
    label: string;
    updatedAt: string | null;
  } | null;
  prediction: MatchPrediction | null;
  dataQuality: MatchDataQuality | null;
};

type Odds1x2DbRow = {
  match_id: number;
  selection: string;
  book_odds: number | string | null;
  updated_at: string | null;
  source: string | null;
  pricing_method?: string | null;
};

type League = {
  code: string;
  name: string;
};

type CompetitionMeta = {
  name: string;
  emblem: string | null;
};

type CompetitionDbRow = {
  id: string;
  name: string | null;
  emblem: string | null;
};

type LeagueIconDbRow = {
  app_code: string | null;
  league_name: string | null;
  icon_url: string | null;
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
  { code: "UEL", name: "Europa League" },
  { code: "PL", name: "Premier League" },
  { code: "CH", name: "Championship" },
  { code: "BL1", name: "Bundesliga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "SA", name: "Serie A" },
  { code: "CI", name: "Coppa Italia" },
  { code: "PD", name: "LaLiga" },
  { code: "EK", name: "Ekstraklasa" },
  { code: "POR1", name: "Liga Portugal" },
  { code: "NED1", name: "Eredivisie" },
  { code: "MLS", name: "Major League Soccer" },
  { code: "SPL", name: "Saudi Pro League" },
  { code: "TUR1", name: "Super Lig" },
  { code: "WC", name: "World Cup" },
];

const MARKET_ID_1X2 = "1x2";
const NO_ODDS_MESSAGE = "Jeszcze nie ma kursów dla tego meczu.";
const BETTING_CLOSE_BUFFER_MS = 60_000;
const ESTIMATED_LIVE_AFTER_KICKOFF_MS = 150 * 60 * 1000;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasDisplayableOdd(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasDisplayable1x2Odds(odds: Match["odds"]) {
  return (
    hasDisplayableOdd(odds["1"]) ||
    hasDisplayableOdd(odds.X) ||
    hasDisplayableOdd(odds["2"])
  );
}

function safeInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function safeString(v: unknown): string | null {
  if (v === null || v === undefined) return null;

  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function isDateParam(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function initialSelectedDateFromUrl() {
  if (typeof window === "undefined") return todayLocalYYYYMMDD();

  const date = new URLSearchParams(window.location.search).get("date");
  return isDateParam(date) ? date : todayLocalYYYYMMDD();
}

function safeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];

  return v
    .map((item) => safeString(item))
    .filter((item): item is string => item !== null);
}

type PayloadRecord = Record<string, unknown>;

function asRecord(value: unknown): PayloadRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as PayloadRecord;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function buildDataQualityFromPayload(raw: unknown): MatchDataQuality | null {
  const record = asRecord(raw);
  if (!record) return null;

  const score = safeNum(record.score);
  const label = safeString(record.label);

  if (score === null && !label) return null;

  return {
    score: score ?? 0,
    label: label ?? "Braki",
    hasRealBsdOdds: record.hasRealBsdOdds === true,
    hasModelOdds: record.hasModelOdds === true,
    hasBsdPrediction: record.hasBsdPrediction === true,
    hasBsdFeatures: record.hasBsdFeatures === true,
    hasModelScore: record.hasModelScore === true,
    sourceBadges: safeStringArray(record.sourceBadges),
    missing: safeStringArray(record.missing),
    updatedAt: safeString(record.updatedAt),
  };
}

function buildOddsMetaFromPayload(raw: unknown): Match["oddsMeta"] {
  const record = asRecord(raw);
  if (!record) return null;

  const source = safeString(record.source);
  const pricingMethod = safeString(record.pricingMethod);

  if (!source && !pricingMethod) return null;

  return {
    source,
    pricingMethod,
    isModel: record.isModel === true || source === "internal_model",
    label:
      safeString(record.label) ??
      (source === "internal_model" ? "Kurs modelowy" : "Kursy BSD"),
    updatedAt: safeString(record.updatedAt),
  };
}

function buildPredictionFromPayload(raw: unknown): MatchPrediction | null {
  const record = asRecord(raw);
  if (!record) return null;

  const predictedHomeScore = safeInt(record.predictedHomeScore);
  const predictedAwayScore = safeInt(record.predictedAwayScore);

  const predictedScore =
    safeString(record.predictedScore) ??
    (predictedHomeScore !== null && predictedAwayScore !== null
      ? `${predictedHomeScore}-${predictedAwayScore}`
      : null);

  const probabilitiesRaw = asRecord(record.probabilities) ?? {};

  const prediction: MatchPrediction = {
    source: safeString(record.source),
    market: safeString(record.market),
    predictedScore,
    predictedHomeScore,
    predictedAwayScore,
    predictedResult: safeString(record.predictedResult),
    predictedLabel: safeString(record.predictedLabel),
    scoreSource:
      record.scoreSource === "bsd_prediction" ||
      record.scoreSource === "model_snapshot"
        ? record.scoreSource
        : null,
    scoreProbability: safeNum(record.scoreProbability),
    expectedHomeGoals: safeNum(record.expectedHomeGoals),
    expectedAwayGoals: safeNum(record.expectedAwayGoals),
    probabilities: {
      homeWin: safeNum(probabilitiesRaw.homeWin),
      draw: safeNum(probabilitiesRaw.draw),
      awayWin: safeNum(probabilitiesRaw.awayWin),
      over15: safeNum(probabilitiesRaw.over15),
      over25: safeNum(probabilitiesRaw.over25),
      over35: safeNum(probabilitiesRaw.over35),
      bttsYes: safeNum(probabilitiesRaw.bttsYes),
    },
    confidence: safeNum(record.confidence),
    modelVersion: safeString(record.modelVersion),
    matchConfidence: safeString(record.matchConfidence),
    matchScore: safeNum(record.matchScore),
    sourcePredictionId: safeString(record.sourcePredictionId),
    sourceEventId: safeString(record.sourceEventId),
    updatedAt: safeString(record.updatedAt),
  };

  const hasUsefulData =
    prediction.predictedScore ||
    prediction.predictedHomeScore !== null ||
    prediction.predictedAwayScore !== null ||
    prediction.expectedHomeGoals !== null ||
    prediction.expectedAwayGoals !== null ||
    prediction.confidence !== null;

  return hasUsefulData ? prediction : null;
}

type PredictionDirection = "home" | "draw" | "away";

function normalizePredictionPercent(value: unknown): number | null {
  const n = safeNum(value);
  if (n === null) return null;

  if (Math.abs(n) <= 1) {
    return n * 100;
  }

  return n;
}

function formatPredictionPercent(value: unknown) {
  const n = normalizePredictionPercent(value);
  if (n === null) return "—";

  return `${n.toFixed(Math.abs(n) >= 10 ? 0 : 1)}%`;
}

function predictionDirection(prediction: MatchPrediction): PredictionDirection | null {
  const result = String(prediction.predictedResult ?? "").trim().toUpperCase();
  const label = String(prediction.predictedLabel ?? "").trim().toLowerCase();

  if (result === "H" || result === "1" || label === "home") return "home";
  if (result === "D" || result === "X" || label === "draw") return "draw";
  if (result === "A" || result === "2" || label === "away") return "away";

  return null;
}

function predictionDirectionLabel(
  direction: PredictionDirection | null,
  homeTeam: string,
  awayTeam: string
) {
  if (direction === "home") return homeTeam;
  if (direction === "away") return awayTeam;
  if (direction === "draw") return "Remis";

  return "—";
}

function predictionPickCode(direction: PredictionDirection | null) {
  if (direction === "home") return "1";
  if (direction === "draw") return "X";
  if (direction === "away") return "2";

  return "—";
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

  const formatLongDistance = (minutes: number) => {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;

    const dayLabel = days === 1 ? "dzień" : "dni";

    if (days > 0) {
      if (hours > 0) return `${days} ${dayLabel} ${hours}h`;
      return `${days} ${dayLabel}`;
    }

    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }

    return `${minutes} min`;
  };

  if (diffMs >= 0) {
    if (absMin < 1) return "start za chwilę";
    if (absMin < 60) return `start za ${absMin} min`;

    return `start za ${formatLongDistance(absMin)}`;
  }

  if (absMin < 60) return `w toku od ${absMin} min`;

  return `po starcie ${formatLongDistance(absMin)}`;
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

function isNonLiveTerminalStatus(status?: string | null) {
  const s = String(status || "").toUpperCase();

  return (
    s === "FINISHED" ||
    s === "CANCELED" ||
    s === "CANCELLED" ||
    s === "POSTPONED" ||
    s === "SUSPENDED" ||
    s === "AWARDED"
  );
}

function isEffectivelyLiveByClock(args: {
  status?: string | null;
  kickoffUtc?: string | null;
  explicitLive?: boolean;
  explicitFinished?: boolean;
  nowMs: number;
}) {
  if (args.explicitFinished) return false;
  if (args.explicitLive) return true;

  const status = String(args.status || "").toUpperCase();

  if (isLiveStatus(status)) return true;
  if (isNonLiveTerminalStatus(status)) return false;

  const canEstimateLive =
    status === "TIMED" ||
    status === "SCHEDULED" ||
    status === "PRE_MATCH" ||
    status === "NOT_STARTED";

  if (!canEstimateLive) return false;

  const kickoffTs = Date.parse(String(args.kickoffUtc || ""));
  if (!Number.isFinite(kickoffTs)) return false;

  return (
    args.nowMs >= kickoffTs &&
    args.nowMs <= kickoffTs + ESTIMATED_LIVE_AFTER_KICKOFF_MS
  );
}

function isEffectivelyLiveMatch(m: Match, nowMs: number) {
  return isEffectivelyLiveByClock({
    status: m.status,
    kickoffUtc: m.kickoffUtc,
    explicitLive: m.isLive,
    explicitFinished: m.isFinished,
    nowMs,
  });
}

function estimateLiveMinute(kickoffUtc: string, nowMs: number): number | null {
  const kickoffTs = Date.parse(kickoffUtc);
  if (!Number.isFinite(kickoffTs)) return null;

  const elapsed = Math.floor((nowMs - kickoffTs) / 60_000) + 1;
  if (elapsed < 1) return null;

  if (elapsed <= 45) return elapsed;
  if (elapsed <= 60) return 45;

  const secondHalfMinute = elapsed - 15;
  if (secondHalfMinute <= 90) return Math.max(46, secondHalfMinute);

  return 90;
}

function formatLiveClock(m: Match, nowMs: number) {
  if (!isEffectivelyLiveMatch(m, nowMs)) return null;

  const minute =
    typeof m.minute === "number" && Number.isFinite(m.minute) && m.minute >= 0
      ? m.minute
      : estimateLiveMinute(m.kickoffUtc, nowMs);

  if (minute === null) return null;

  const injuryTime =
    typeof m.injuryTime === "number" &&
    Number.isFinite(m.injuryTime) &&
    m.injuryTime > 0
      ? m.injuryTime
      : null;

  if (injuryTime !== null) return `${minute}+${injuryTime}'`;
  return `${minute}'`;
}

function getMatchAvailability(m: Match, nowMs: number): MatchAvailability {
  const finished = m.isFinished || isFinishedStatus(m.status);
  const live = isEffectivelyLiveMatch(m, nowMs);
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
  if (isEffectivelyLiveMatch(m, nowMs)) return 0;

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

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readTeamNameFromMatch(rawMatch: unknown, side: "home" | "away") {
  const m = asRecord(rawMatch);
  if (!m) return side === "home" ? "Home" : "Away";

  const homeTeam = asRecord(m.homeTeam);
  const homeTeamObj = asRecord(m.home_team_obj);
  const awayTeam = asRecord(m.awayTeam);
  const awayTeamObj = asRecord(m.away_team_obj);

  if (side === "home") {
    return (
      firstText(
        homeTeam?.name,
        homeTeam?.shortName,
        homeTeam?.short_name,
        homeTeamObj?.name,
        homeTeamObj?.short_name,
        m.home_team_name,
        m.homeTeamName,
        m.home_name,
        m.home_team,
        m.home
      ) ?? "Home"
    );
  }

  return (
    firstText(
      awayTeam?.name,
      awayTeam?.shortName,
      awayTeam?.short_name,
      awayTeamObj?.name,
      awayTeamObj?.short_name,
      m.away_team_name,
      m.awayTeamName,
      m.away_name,
      m.away_team,
      m.away
    ) ?? "Away"
  );
}

function readTeamIdFromMatch(rawMatch: unknown, side: "home" | "away") {
  const m = asRecord(rawMatch);
  if (!m) return null;

  const homeTeam = asRecord(m.homeTeam);
  const homeTeamObj = asRecord(m.home_team_obj);
  const awayTeam = asRecord(m.awayTeam);
  const awayTeamObj = asRecord(m.away_team_obj);

  const raw =
    side === "home"
      ? homeTeam?.id ??
        homeTeamObj?.id ??
        m.home_team_id ??
        m.homeTeamId ??
        null
      : awayTeam?.id ??
        awayTeamObj?.id ??
        m.away_team_id ??
        m.awayTeamId ??
        null;

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readTeamCrestFromMatch(rawMatch: unknown, side: "home" | "away") {
  const m = asRecord(rawMatch);
  if (!m) return null;

  const team = asRecord(side === "home" ? m.homeTeam : m.awayTeam);
  const teamObj = asRecord(side === "home" ? m.home_team_obj : m.away_team_obj);

  return firstText(
    team?.crest,
    team?.logo,
    team?.emblem,
    team?.image,
    teamObj?.crest,
    teamObj?.logo,
    teamObj?.emblem,
    teamObj?.image
  );
}

function buildMatchesFromPayload(payload: unknown, selectedDate: string): Match[] {
  const all: Match[] = [];
  const payloadRecord = asRecord(payload);
  const results = Array.isArray(payloadRecord?.results)
    ? payloadRecord.results
    : [];

  for (const itemRaw of results) {
    const item = asRecord(itemRaw);
    const league = asRecord(item?.league);
    const code = safeString(league?.code);

    if (!code) continue;

    const fixtures = asRecord(item?.fixtures);
    const competition = asRecord(fixtures?.competition);
    const competitionName =
      safeString(competition?.name) ?? safeString(league?.name) ?? code;
    const list = Array.isArray(fixtures?.matches) ? fixtures.matches : [];

    for (const matchRaw of list) {
      const m = asRecord(matchRaw);
      const utc = safeString(m?.utcDate);
      if (!utc) continue;

      const time = formatLocalTime(utc);

      const homeId = readTeamIdFromMatch(m, "home");
      const awayId = readTeamIdFromMatch(m, "away");
      const homeCrest = readTeamCrestFromMatch(m, "home");
      const awayCrest = readTeamCrestFromMatch(m, "away");

      const homeName = readTeamNameFromMatch(m, "home");
      const awayName = readTeamNameFromMatch(m, "away");
      const displayScore = asRecord(m?.displayScore);
      const score = asRecord(m?.score);
      const fullTimeScore = asRecord(score?.fullTime);
      const live = asRecord(m?.live);
      const odds = asRecord(m?.odds);
      const displayHomeScore = safeNum(displayScore?.home);
      const displayAwayScore = safeNum(displayScore?.away);
      const canonicalHomeScore = safeNum(fullTimeScore?.home);
      const canonicalAwayScore = safeNum(fullTimeScore?.away);

      all.push({
        id: String(m?.id),
        competitionCode: code,
        competitionName,
        leagueLine: `${competitionName} • ${time}`,
        homeId,
        awayId,
        homeCrest,
        awayCrest,
        home: homeName,
        away: awayName,
        time,
        kickoffUtc: utc,
        status: String(m?.status ?? "SCHEDULED"),
        isLive: live?.isLive === true,
        isFinished: live?.isFinished === true,
        homeScore: displayHomeScore ?? canonicalHomeScore,
        awayScore: displayAwayScore ?? canonicalAwayScore,
        minute: safeInt(m?.minute),
        injuryTime: safeInt(m?.injuryTime ?? m?.injury_time),
        odds: {
          "1": safeNum(odds?.["1"]),
          X: safeNum(odds?.X),
          "2": safeNum(odds?.["2"]),
        },
        oddsMeta: buildOddsMetaFromPayload(m?.oddsMeta),
        prediction: buildPredictionFromPayload(m?.prediction),
        dataQuality: buildDataQualityFromPayload(m?.dataQuality),
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
    .select("match_id, selection, book_odds, updated_at, source, pricing_method")
    .in("match_id", matchIds)
    .eq("market_id", MARKET_ID_1X2)
    .or("source.eq.bsd,source.eq.internal_model");

  if (error) {
    throw new Error(`Nie udało się pobrać kursów 1X2 z bazy: ${error.message}`);
  }

  const byMatch = new Map<string, Match["odds"]>();
  const metaByMatch = new Map<string, NonNullable<Match["oddsMeta"]>>();
  let latestOddsUpdatedAt: string | null = null;

  for (const row of (data ?? []) as Odds1x2DbRow[]) {
    const matchId = String(row.match_id);
    const selection = String(row.selection) as Pick;

    if (selection !== "1" && selection !== "X" && selection !== "2") continue;
    const isBsd =
      row.source === "bsd" && row.pricing_method === "bsd_market_normalized";
    const isModel =
      row.source === "internal_model" &&
      row.pricing_method === "internal_model_fallback";
    if (!isBsd && !isModel) continue;

    const odd = safeNum(row.book_odds);
    if (odd === null || odd <= 0) continue;
    const existingMeta = metaByMatch.get(matchId);
    if (existingMeta?.source === "bsd" && !isBsd) continue;

    const current = byMatch.get(matchId) ?? { "1": null, X: null, "2": null };

    current[selection] = odd;
    byMatch.set(matchId, current);
    metaByMatch.set(matchId, {
      source: row.source,
      pricingMethod: row.pricing_method ?? null,
      isModel,
      label: isBsd ? "Kursy BSD" : "Kurs modelowy",
      updatedAt: row.updated_at,
    });

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
          "1": dbOdds?.["1"] ?? null,
          X: dbOdds?.X ?? null,
          "2": dbOdds?.["2"] ?? null,
        },
        oddsMeta: metaByMatch.get(m.id) ?? null,
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

function getCountdownParts(kickoffUtc: string, nowMs: number) {
  const ts = Date.parse(kickoffUtc);
  if (!Number.isFinite(ts)) return null;

  const diffMs = Math.max(0, ts - nowMs);
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  const seconds = Math.floor((diffMs % 60_000) / 1_000);

  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    { label: "DNI", value: pad(days) },
    { label: "GODZ", value: pad(hours) },
    { label: "MIN", value: pad(minutes) },
    { label: "SEK", value: pad(seconds) },
  ];
}

function PosterTeam({
  name,
  crest,
  side,
  score,
  showScore,
}: {
  name: string;
  crest?: string | null;
  side: "home" | "away";
  score: number | null;
  showScore: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-white/15 blur-xl" />
        <LeagueIcon
          src={crest}
          alt={name}
          size={72}
          fallback={name.slice(0, 1)}
          className="relative rounded-full border-white/15 bg-white p-2.5 shadow-[0_12px_30px_rgba(0,0,0,0.35)] sm:p-3"
        />
      </div>

      <div className="mt-2 max-w-full truncate text-sm font-semibold tracking-tight text-white sm:mt-3 sm:text-lg lg:text-xl">
        {name}
      </div>

      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.22em] text-neutral-500 sm:text-[10px]">
        {side === "home" ? "HOME" : "AWAY"}
      </div>

      {showScore ? (
        <div className="mt-2 min-w-10 rounded-xl border border-white/10 bg-white/[0.06] px-2.5 py-1 text-lg font-semibold text-white shadow-inner sm:mt-3 sm:min-w-12 sm:px-3 sm:py-1.5 sm:text-xl">
          {score ?? 0}
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

function dataQualityTone(label?: string | null): "neutral" | "green" | "yellow" | "blue" {
  const normalized = String(label ?? "").toLowerCase();
  if (normalized === "premium") return "green";
  if (normalized === "solidne") return "blue";
  if (normalized === "czesciowe" || normalized === "częściowe") return "yellow";
  return "neutral";
}

function dataQualityLabel(label?: string | null) {
  const normalized = String(label ?? "").toLowerCase();
  if (normalized === "czesciowe") return "Częściowe";
  return label || "Braki";
}

function MatchDataQualityStrip({
  match,
  compact = false,
}: {
  match: Match;
  compact?: boolean;
}) {
  const quality = match.dataQuality;

  if (!quality) return null;

  const badges = quality?.sourceBadges.slice(0, compact ? 2 : 4) ?? [];
  const missing = quality?.missing.slice(0, compact ? 1 : 2) ?? [];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
      {quality ? (
        <SmallPill tone={dataQualityTone(quality.label)}>
          Data BSD {dataQualityLabel(quality.label)} · {quality.score}/100
        </SmallPill>
      ) : null}

      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-neutral-800 bg-black/20 px-2.5 py-1 font-semibold text-neutral-300"
        >
          {badge}
        </span>
      ))}

      {!quality?.hasRealBsdOdds && missing.length > 0 ? (
        <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2.5 py-1 font-semibold text-yellow-300">
          Brakuje: {missing.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

function PredictionInlineStrip({
  prediction,
  homeTeam,
  awayTeam,
}: {
  prediction: MatchPrediction | null;
  homeTeam: string;
  awayTeam: string;
}) {
  if (!prediction) return null;

  const direction = predictionDirection(prediction);
  const pick = predictionDirectionLabel(direction, homeTeam, awayTeam);
  const pickCode = predictionPickCode(direction);
  const sourceLabel =
    prediction.scoreSource === "model_snapshot"
      ? "Model xG"
      : prediction.scoreSource === "bsd_prediction"
        ? "Predykcja BSD"
        : prediction.source?.toUpperCase() ?? "AI";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-sky-500/15 bg-sky-500/[0.06] px-3 py-2 text-[11px] text-neutral-300">
      <span className="font-semibold uppercase tracking-[0.16em] text-sky-300">
        AI
      </span>
      <span className="font-semibold text-white">
        {prediction.predictedScore ?? "—"}
      </span>
      <span className="text-neutral-500">{sourceLabel}</span>
      <span className="text-neutral-500">
        Kierunek {pickCode}: <span className="text-neutral-200">{pick}</span>
      </span>
      <span className="text-neutral-500">
        1 {formatPredictionPercent(prediction.probabilities.homeWin)}
      </span>
      <span className="text-neutral-500">
        X {formatPredictionPercent(prediction.probabilities.draw)}
      </span>
      <span className="text-neutral-500">
        2 {formatPredictionPercent(prediction.probabilities.awayWin)}
      </span>
    </div>
  );
}

function LeagueButton({
  active,
  label,
  count,
  emblem,
  fallback,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  emblem?: string | null;
  fallback?: ReactNode;
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
      <span className="flex min-w-0 items-center gap-3">
        <LeagueIcon
          src={emblem}
          alt={label}
          size={20}
          fallback={fallback ?? label.slice(0, 1)}
          className={
            active ? "border-black/10 bg-black/5 text-black/60" : undefined
          }
        />

        <span className="min-w-0 truncate text-sm font-semibold">{label}</span>
      </span>

      <span
        className={cn(
          "ml-3 shrink-0 rounded-full border px-2 py-0.5 text-xs",
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

  const [selectedDate, setSelectedDate] = useState<string>(
    initialSelectedDateFromUrl
  );
  const [selectedLeague, setSelectedLeague] = useState<string>("ALL");
  const [activeRightTab, setActiveRightTab] = useState<"matches" | "table">(
    "matches"
  );
  const [sortMode, setSortMode] = useState<SortMode>("smart");
  const [searchQuery, setSearchQuery] = useState("");

  const [enabledDates, setEnabledDates] = useState<string[]>([]);
  const [enabledDatesLoaded, setEnabledDatesLoaded] = useState(false);
  const enabledDatesCacheRef = useRef<string[] | null>(null);
  const enabledDatesRequestRef = useRef<Promise<string[]> | null>(null);
  const initialSelectedDateRef = useRef<string | null>(null);

  if (initialSelectedDateRef.current === null) {
    initialSelectedDateRef.current = selectedDate;
  }

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
  const [competitionMetaByCode, setCompetitionMetaByCode] = useState<
    Record<string, CompetitionMeta>
  >({});

  const matchesCacheRef = useRef<Record<string, Match[]>>({});
  const matchesLoadedAtCacheRef = useRef<Record<string, string | null>>({});
  const horizonCacheRef = useRef<Record<string, string | null>>({});
  const beyondCacheRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCompetitions = async () => {
      const map: Record<string, CompetitionMeta> = {};

      const { data: iconRows, error: iconError } = await supabase
        .from("icons_leagues")
        .select("app_code, league_name, icon_url")
        .eq("provider", "bsd");

      if (!cancelled && !iconError) {
        for (const row of (iconRows ?? []) as LeagueIconDbRow[]) {
          const id = String(row.app_code || "").trim();
          if (!id) continue;

          map[id] = {
            name: row.league_name ? String(row.league_name) : id,
            emblem:
              typeof row.icon_url === "string" && row.icon_url.trim().length > 0
                ? row.icon_url.trim()
                : null,
          };
        }
      }

      const { data, error } = await supabase
        .from("competitions")
        .select("id, name, emblem");

      if (cancelled) return;

      if (!error) {
        for (const row of (data ?? []) as CompetitionDbRow[]) {
          const id = String(row.id || "").trim();
          if (!id) continue;

          map[id] = {
            name: map[id]?.name ?? (row.name ? String(row.name) : id),
            emblem:
              map[id]?.emblem ??
              (typeof row.emblem === "string" && row.emblem.trim().length > 0
                ? row.emblem.trim()
                : null),
          };
        }
      }

      setCompetitionMetaByCode(map);
    };

    void loadCompetitions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const currentNowMs = Date.now();
      const isToday = selectedDate === todayLocalYYYYMMDD();

      if (!isToday) return;

      const shouldRefreshToday = matches.some((m) => {
        if (isEffectivelyLiveMatch(m, currentNowMs)) return true;
        if (m.isFinished || isFinishedStatus(m.status)) return false;

        const kickoffTs = Date.parse(m.kickoffUtc);
        if (!Number.isFinite(kickoffTs)) return false;

        const startsSoonOrStarted = currentNowMs >= kickoffTs - 2 * 60 * 1000;
        const stillRelevant = currentNowMs <= kickoffTs + 4 * 60 * 60 * 1000;

        return startsSoonOrStarted && stillRelevant;
      });

      if (!shouldRefreshToday) return;

      delete matchesCacheRef.current[selectedDate];
      delete matchesLoadedAtCacheRef.current[selectedDate];
      delete horizonCacheRef.current[selectedDate];
      delete beyondCacheRef.current[selectedDate];

      setReloadKey((v) => v + 1);
    }, 15_000);

    return () => window.clearInterval(id);
  }, [selectedDate, matches]);

  const availableLeagues = useMemo(() => {
    const baseOrder = new Map(
      FREE_TIER_LEAGUES.map((league, index) => [league.code, index])
    );

    const byCode = new Map<string, League>();

    for (const league of FREE_TIER_LEAGUES) {
      byCode.set(league.code, league);
    }

    for (const match of matches) {
      const code = String(match.competitionCode ?? "").trim().toUpperCase();
      const name = String(match.competitionName ?? "").trim();

      if (!code) continue;

      if (!byCode.has(code)) {
        byCode.set(code, {
          code,
          name: name || code,
        });
      }
    }

    return Array.from(byCode.values()).sort((a, b) => {
      const orderA = baseOrder.get(a.code) ?? 999;
      const orderB = baseOrder.get(b.code) ?? 999;

      if (orderA !== orderB) return orderA - orderB;

      return a.name.localeCompare(b.name, "pl");
    });
  }, [matches]);

  const selectedLeagueLabel = useMemo(() => {
    if (selectedLeague === "ALL") return "Wszystkie ligi";

    return (
      availableLeagues.find((x) => x.code === selectedLeague)?.name ??
      selectedLeague
    );
  }, [availableLeagues, selectedLeague]);

  const loadEnabledDates = useCallback(
    async (preferredDate?: string, options?: { force?: boolean }) => {
      const force = options?.force === true;
      const base = todayLocalYYYYMMDD();

      if (!force && enabledDatesCacheRef.current) {
        const cached = enabledDatesCacheRef.current;
        setEnabledDates(cached);
        setEnabledDatesLoaded(true);
        return cached;
      }

      if (!force && enabledDatesRequestRef.current) {
        return enabledDatesRequestRef.current;
      }

      const request = (async () => {
        const hadCache = enabledDatesCacheRef.current !== null;

        if (!hadCache) {
          setEnabledDatesLoaded(false);
        }

        const r = await fetch(
          `/api/events-enabled-dates?from=${encodeURIComponent(base)}&days=14`,
          { cache: "no-store" }
        );

        const payload = await r.json().catch(() => null);

        if (!r.ok || !Array.isArray(payload?.enabledDates)) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "events-enabled-dates failed"
          );
        }

        const rawEnabledDates = payload.enabledDates as unknown[];

        const arr: string[] = Array.from(
          new Set(
            rawEnabledDates
              .map((value) => String(value))
              .filter((value): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value))
          )
        ).sort();

        enabledDatesCacheRef.current = arr;
        setEnabledDates(arr);
        setEnabledDatesLoaded(true);

        if (
          preferredDate &&
          arr.length > 0 &&
          !arr.includes(preferredDate)
        ) {
          setSelectedDate(arr[0]);
        }

        return arr;
      })();

      enabledDatesRequestRef.current = request;

      try {
        return await request;
      } catch {
        const cached = enabledDatesCacheRef.current;

        if (cached) {
          setEnabledDates(cached);
          setEnabledDatesLoaded(true);
          return cached;
        }

        setEnabledDatesLoaded(true);
        return [];
      } finally {
        if (enabledDatesRequestRef.current === request) {
          enabledDatesRequestRef.current = null;
        }
      }
    },
    []
  );

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
    void loadEnabledDates(initialSelectedDateRef.current ?? undefined);
  }, [loadEnabledDates]);

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
      let j: PayloadRecord = {};

      try {
        j = asRecord(text ? JSON.parse(text) : {}) ?? {};
      } catch {
        j = { raw: text?.slice(0, 300) || "" };
      }

      if (!r.ok) {
        const msg =
          safeString(j.error) ||
          safeString(j.message) ||
          safeString(j.raw) ||
          `odds sync failed (HTTP ${r.status})`;

        setMatchesError(`Nie udało się zsynchronizować kursów: ${msg}`);
        return;
      }

      const rr = await fetch(
        `/api/events?date=${encodeURIComponent(selectedDate)}`,
        { cache: "no-store" }
      );

      const text2 = await rr.text();
      let payload: PayloadRecord = {};

      try {
        payload = asRecord(JSON.parse(text2)) ?? {};
      } catch {
        payload = { error: text2?.slice(0, 300) || "Non-JSON response" };
      }

      if (!rr.ok) {
        const msg =
          safeString(payload.error) || `Błąd /api/events (HTTP ${rr.status})`;
        setMatchesError(msg);
        return;
      }

      const apiHorizonTo =
        typeof payload.horizonTo === "string" ? payload.horizonTo : null;

      setHorizonYmd(apiHorizonTo);

      const apiSaysBeyond = Boolean(payload.isBeyondHorizon);
      const uiSaysBeyond = isBeyondHorizonDay(selectedDate, apiHorizonTo);

      if (apiSaysBeyond || uiSaysBeyond) {
        matchesCacheRef.current[selectedDate] = [];
        horizonCacheRef.current[selectedDate] = apiHorizonTo;
        beyondCacheRef.current[selectedDate] = true;

        setBeyondHorizon(true);
        setMatches([]);
        setMatchesLoadedAt(new Date().toISOString());
        setMatchesError(null);

        void loadEnabledDates();
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
        (typeof payload.updatedAt === "string"
          ? payload.updatedAt
          : new Date().toISOString());

      matchesCacheRef.current[selectedDate] = hydratedMatches;
      matchesLoadedAtCacheRef.current[selectedDate] = loadedAt;
      horizonCacheRef.current[selectedDate] = apiHorizonTo;
      beyondCacheRef.current[selectedDate] = false;

      setBeyondHorizon(false);
      setMatches(hydratedMatches);
      setMatchesLoadedAt(loadedAt);

      void loadEnabledDates();
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
        let payload: PayloadRecord = {};

        try {
          payload = asRecord(JSON.parse(text)) ?? {};
        } catch {
          payload = { error: text?.slice(0, 300) || "Non-JSON response" };
        }

        if (!r.ok) {
          if (!cancelled) {
            setMatchesError(
              safeString(payload.error) || `Błąd /api/events (HTTP ${r.status})`
            );
          }
          return;
        }

        const apiHorizonTo =
          typeof payload.horizonTo === "string" ? payload.horizonTo : null;

        if (!cancelled) setHorizonYmd(apiHorizonTo);

        const apiSaysBeyond = Boolean(payload.isBeyondHorizon);
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
          (typeof payload.updatedAt === "string"
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
      } catch (e: unknown) {
        if (!cancelled) {
          setMatchesError(getErrorMessage(e, "Nie udało się pobrać meczów."));
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
        let j: PayloadRecord = {};

        try {
          j = asRecord(JSON.parse(text)) ?? {};
        } catch {
          j = { error: text?.slice(0, 300) || "Non-JSON response" };
        }

        if (!r.ok) {
          if (!cancelled) {
            setStandings(null);
            setStandingsError(
              safeString(j.error) || `Błąd /api/standings (HTTP ${r.status})`
            );
          }
          return;
        }

        const rows: StandingsRowUI[] = Array.isArray(j.rows)
          ? (j.rows as StandingsRowUI[])
          : [];
        rows.sort((a, b) => Number(a.position) - Number(b.position));

        if (!cancelled) {
          setStandings({
            competitionCode: String(j.competitionCode || selectedLeague),
            competitionName:
              String(j.competitionName || "") ||
              FREE_TIER_LEAGUES.find((x) => x.code === selectedLeague)?.name ||
              selectedLeague,
            season: j.season ? String(j.season) : null,
            rows,
          });
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setStandings(null);
          setStandingsError(getErrorMessage(e, "Nie udało się pobrać tabeli."));
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
    () => filteredMatches.filter((m) => isEffectivelyLiveMatch(m, nowMs)),
    [filteredMatches, nowMs]
  );

  const openMatches = useMemo(
    () =>
      filteredMatches.filter((m) => {
        if (isEffectivelyLiveMatch(m, nowMs)) return false;
        if (m.isFinished || isFinishedStatus(m.status)) return false;
        return true;
      }),
    [filteredMatches, nowMs]
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

  const matchesWithPredictionsCount = useMemo(
    () => filteredMatches.filter((m) => !!m.prediction).length,
    [filteredMatches]
  );

  const openSectionTitle =
    selectedDate === todayLocalYYYYMMDD() ? "Dziś" : "Zaplanowane";

  const regularOpenMatches = openMatches;

  const leagueCounts = useMemo(() => {
    const map: Record<string, number> = { ALL: matches.length };

    for (const league of availableLeagues) {
      map[league.code] = matches.filter(
        (m) => m.competitionCode === league.code
      ).length;
    }

    return map;
  }, [availableLeagues, matches]);

  const goMatch = (m: Match) => {
    const qs = new URLSearchParams();

    qs.set("c", m.competitionCode);
    if (m.homeId != null) qs.set("h", String(m.homeId));
    if (m.awayId != null) qs.set("a", String(m.awayId));
    qs.set("k", m.kickoffUtc);
    qs.set("hn", m.home);
    qs.set("an", m.away);
    qs.set("date", selectedDate);

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
    const hasAnyOdds = hasDisplayable1x2Odds(m.odds);
    const isModelOdds = m.oddsMeta?.isModel === true;

    return (
      <div onClick={(e) => e.stopPropagation()}>
        {isModelOdds ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[11px] font-semibold text-cyan-200">
            <span>Kurs modelowy</span>
            <span className="text-cyan-200/70">BSD nie podało kursów</span>
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          {(["1", "X", "2"] as Pick[]).map((pick) => {
            const active = isActivePick(m.id, MARKET_ID_1X2, pick);

            const oddRaw = m.odds[pick];
            const hasOdd = hasDisplayableOdd(oddRaw);
            const odd = hasOdd ? oddRaw : 0;

            const disabled = !hasOdd || availability.closed;
            const title = !hasOdd
              ? NO_ODDS_MESSAGE
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
                  "group rounded-2xl border px-2.5 py-2.5 text-center transition sm:px-3 sm:py-3",
                  disabled
                    ? "cursor-not-allowed border-neutral-800 bg-neutral-950/70 text-neutral-600"
                    : active
                      ? "border-white bg-white text-black shadow-[0_10px_35px_rgba(255,255,255,0.12)]"
                      : isModelOdds
                        ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-100 hover:border-cyan-400/40 hover:bg-cyan-500/15"
                        : "border-neutral-800 bg-neutral-950 text-white hover:border-neutral-600 hover:bg-neutral-900"
                )}
                title={title}
                aria-pressed={active}
                aria-label={`${pickLabel(pick)} ${hasOdd ? formatOdd(odd) : "brak kursu"}`}
              >
                <div className="text-xs font-semibold leading-none sm:text-sm">
                  {shortPickLabel(pick)}
                </div>

                <div className="mt-1 hidden text-[10px] opacity-70 sm:block">
                  {pickLabel(pick)}
                </div>

                <div className="mt-1 text-xs font-semibold sm:text-sm">
                  {hasOdd ? formatOdd(odd) : "—"}
                </div>
              </button>
            );
          })}
        </div>

        {!hasAnyOdds ? (
          <div className="mt-2 rounded-2xl border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-center text-xs font-medium text-neutral-400">
            {NO_ODDS_MESSAGE}
          </div>
        ) : null}
      </div>
    );
  };

  const renderMatchCard = (m: Match) => {
    const distance = formatKickoffDistance(m.kickoffUtc, nowMs);
    const liveClock = formatLiveClock(m, nowMs);
    const countdown = getCountdownParts(m.kickoffUtc, nowMs);
    const showScore = hasVisibleScore(m);
    const isLive = isEffectivelyLiveMatch(m, nowMs);

    return (
      <article
        key={m.id}
        className={cn(
          "group overflow-hidden rounded-[24px] border shadow-[0_20px_70px_rgba(0,0,0,0.42)] transition duration-300 hover:-translate-y-0.5 hover:border-cyan-300/35 hover:shadow-[0_28px_95px_rgba(6,182,212,0.16)]",
          isLive
            ? "border-red-400/30 bg-red-950/10"
            : m.oddsMeta?.isModel
              ? "border-cyan-400/25 bg-cyan-950/10"
              : "border-white/10 bg-[#07090f]"
        )}
      >
        <div className="relative overflow-hidden bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px),radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.24),transparent_36%),linear-gradient(120deg,#050810,#0a1020_48%,#05070c)] bg-[size:84px_84px,84px_84px,100%_100%,100%_100%] px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-[radial-gradient(circle_at_30%_50%,rgba(20,184,166,0.14),transparent_52%)]" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_70%_50%,rgba(59,130,246,0.16),transparent_52%)]" />

          <div className="relative z-10 grid min-h-[190px] grid-cols-[1fr_auto_1fr] items-center gap-3 sm:min-h-[220px] sm:gap-6 lg:min-h-[245px] lg:gap-8">
            <PosterTeam
              name={m.home}
              crest={m.homeCrest}
              side="home"
              score={m.homeScore}
              showScore={showScore}
            />

            <div className="flex min-w-0 flex-col items-center text-center">
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/12 bg-white/[0.07] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-200 shadow-[0_8px_30px_rgba(0,0,0,0.24)] backdrop-blur sm:px-4 sm:py-2 sm:text-[10px]">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isLive ? "animate-pulse bg-red-400" : "bg-emerald-400"
                  )}
                />
                <span>{isLive ? "LIVE" : "Featured"}</span>
                <span className="text-neutral-500">/</span>
                <span className="truncate">{distance}</span>
              </div>

              <div className="mt-4 flex max-w-full items-center justify-center gap-2 text-base font-semibold tracking-tight text-white sm:mt-5 sm:text-xl lg:text-2xl">
                <LeagueIcon
                  src={competitionMetaByCode[m.competitionCode]?.emblem ?? null}
                  alt={m.competitionName}
                  size={18}
                  fallback={m.competitionCode.slice(0, 2)}
                  className="rounded-full bg-white/8"
                />
                <span className="truncate">{m.competitionName}</span>
              </div>

              <div className="mt-2 text-3xl font-black tracking-tight text-white/10 sm:mt-3 sm:text-5xl lg:text-6xl">
                VS
              </div>

              <div className="mt-2 text-xs font-semibold text-neutral-300 sm:text-sm">
                {formatLocalDateTime(m.kickoffUtc)}
              </div>

              <div className="mt-2 flex justify-center">
                <MatchStatusPill match={m} nowMs={nowMs} />
              </div>

              {isLive ? (
                <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 shadow-[0_0_30px_rgba(248,113,113,0.14)] sm:mt-4 sm:px-5 sm:py-3 sm:text-sm">
                  Na żywo {liveClock ? `- ${liveClock}` : ""}
                </div>
              ) : countdown ? (
                <div className="mt-3 grid grid-cols-4 gap-1.5 sm:mt-4 sm:gap-2">
                  {countdown.map((part) => (
                    <div
                      key={part.label}
                      className="min-w-11 rounded-xl border border-white/10 bg-white/[0.07] px-2 py-2 text-center shadow-inner backdrop-blur sm:min-w-14 sm:rounded-2xl sm:px-3 sm:py-3"
                    >
                      <div className="text-lg font-black leading-none text-white sm:text-2xl">
                        {part.value}
                      </div>
                      <div className="mt-1 text-[8px] font-bold uppercase tracking-[0.18em] text-neutral-500 sm:text-[9px]">
                        {part.label}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => goMatch(m)}
                className="mt-4 rounded-full bg-white px-4 py-2 text-xs font-bold text-neutral-950 shadow-[0_12px_30px_rgba(255,255,255,0.14)] transition hover:scale-[1.02] hover:bg-cyan-50 sm:mt-5 sm:px-6 sm:py-3 sm:text-sm"
              >
                Otwórz mecz &rarr;
              </button>
            </div>

            <PosterTeam
              name={m.away}
              crest={m.awayCrest}
              side="away"
              score={m.awayScore}
              showScore={showScore}
            />
          </div>
        </div>

        <div className="border-t border-white/10 bg-black/28 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {!checkingAdmin && isAdmin ? (
                <>
                  <MatchDataQualityStrip match={m} />
                  <PredictionInlineStrip
                    prediction={m.prediction}
                    homeTeam={m.home}
                    awayTeam={m.away}
                  />
                </>
              ) : null}
            </div>

            <div className="hidden text-[11px] font-semibold text-neutral-500 sm:block">
              Kliknij kurs, żeby dodać typ do kuponu.
            </div>
          </div>

          <div className="mt-3 sm:mt-4">{renderMarketButtons(m)}</div>
        </div>
      </article>
    );
  };

  const dayToolsPanel = (
    <details className="rounded-3xl border border-neutral-800 bg-neutral-950/70 p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            Narzędzia dnia
          </div>
          <div className="mt-1 text-sm text-neutral-400">
            Ręczne odświeżenie meczów i administracyjna synchronizacja kursów.
          </div>
        </div>

        <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs font-semibold text-neutral-300">
          Pokaż
        </span>
      </summary>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={refreshCurrentDay}
          disabled={loadingMatches}
          className={cn(
            "rounded-2xl border px-4 py-3 text-sm font-semibold transition",
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
              "rounded-2xl px-4 py-3 text-sm font-semibold transition",
              syncingOdds
                ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                : "bg-white text-black hover:bg-neutral-200"
            )}
          >
            {syncingOdds ? "Synchronizuję kursy…" : "Synchronizuj kursy"}
          </button>
        ) : null}
      </div>
    </details>
  );

  const renderCalendarPanel = () => (
    <SurfaceCard className="p-4">
      <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
        Kalendarz
      </div>

      <div className="mt-3 text-2xl font-semibold text-white">
        Wybierz dzień
      </div>

      <p className="mt-3 text-sm leading-6 text-neutral-400">
        Przełącz dzień i sprawdź dostępne mecze.
      </p>

      <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-2">
        <DayBar
          value={selectedDate}
          onChange={setSelectedDate}
          enabledDates={enabledDates}
          enabledDatesLoaded={enabledDatesLoaded}
          showCalendarInline
        />
      </div>
    </SurfaceCard>
  );

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
    <div className="grid gap-5 2xl:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="hidden min-w-0 xl:block">
        <div className="sticky top-24 space-y-4">
          {renderCalendarPanel()}

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

              {!checkingAdmin && isAdmin ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <SmallPill tone="red">LIVE {liveMatches.length}</SmallPill>
                  <SmallPill tone="green">Open {openMatches.length}</SmallPill>
                  <SmallPill>Finished {finishedMatches.length}</SmallPill>
                </div>
              ) : null}
            </div>

            <div className="mt-5 space-y-2">
              <LeagueButton
                active={selectedLeague === "ALL"}
                label="Wszystkie ligi"
                count={leagueCounts.ALL ?? 0}
                emblem={null}
                onClick={() => {
                  setSelectedLeague("ALL");
                  setActiveRightTab("matches");
                }}
              />

              {availableLeagues.map((lg) => (
                <LeagueButton
                  key={lg.code}
                  active={selectedLeague === lg.code}
                  label={lg.name}
                  count={leagueCounts[lg.code] ?? 0}
                  emblem={competitionMetaByCode[lg.code]?.emblem ?? null}
                  fallback={lg.code}
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
        <SurfaceCard className="overflow-hidden">
          <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.11),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.95),rgba(5,5,5,0.98))] p-5 sm:p-6">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Football
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Mecze, kursy i typy
              </h1>

              {!checkingAdmin && isAdmin ? (
                <>
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

                    <SmallPill
                      tone={matchesWithPredictionsCount > 0 ? "blue" : "neutral"}
                    >
                      AI predictions:{" "}
                      <span className="ml-1 font-semibold text-white">
                        {matchesWithPredictionsCount}
                      </span>
                    </SmallPill>

                    {beyondHorizon ? (
                      <SmallPill tone="yellow">Poza horyzontem danych</SmallPill>
                    ) : null}
                  </div>
                </>
              ) : null}
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
                <span className="font-semibold text-white">
                  {horizonYmd ?? "—"}
                </span>
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

        <div className="xl:hidden">
          {renderCalendarPanel()}
        </div>

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
              <LeagueIcon
                src={null}
                alt="Wszystkie ligi"
                size={16}
                fallback="W"
                className={
                  selectedLeague === "ALL"
                    ? "border-black/10 bg-black/5 text-black/60"
                    : undefined
                }
              />

              <span>Wszystkie</span>

              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs",
                  selectedLeague === "ALL"
                    ? "border-black/15 text-black"
                    : "border-neutral-700 text-neutral-300"
                )}
              >
                {leagueCounts.ALL ?? 0}
              </span>
            </button>

            {availableLeagues.map((lg) => (
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
                <LeagueIcon
                  src={competitionMetaByCode[lg.code]?.emblem ?? null}
                  alt={lg.name}
                  size={16}
                  fallback={lg.code}
                  className={
                    selectedLeague === lg.code
                      ? "border-black/10 bg-black/5 text-black/60"
                      : undefined
                  }
                />

                <span>{lg.name}</span>

                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs",
                    selectedLeague === lg.code
                      ? "border-black/15 text-black"
                      : "border-neutral-700 text-neutral-300"
                  )}
                >
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

              {regularOpenMatches.length > 0 ? (
                <div className="space-y-3">
                  <SectionHeader
                    title={openSectionTitle}
                    count={regularOpenMatches.length}
                    subtitle="Zakłady zamykają się minutę przed startem meczu."
                  />
                  <div className="space-y-3">
                    {regularOpenMatches.map((m) => renderMatchCard(m))}
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

              {!checkingAdmin && isAdmin ? dayToolsPanel : null}
            </div>
          )
        ) : (
          renderStandingsPanel()
        )}
      </div>
    </div>
  );
}
