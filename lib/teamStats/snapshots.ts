export const TEAM_STATS_MODEL_VERSION = "team-stats-from-bsd-features-v1";
export const ALL_COMPETITIONS_ID = "ALL";
export const ALL_COMPETITIONS_NAME = "All competitions";

type Numberish = number | string | null | undefined;
type JsonObject = Record<string, unknown>;

export type MatchPricingFeatureInputRow = {
  match_id: Numberish;
  source_event_id?: string | null;
  competition_id: string | null;
  competition_name: string | null;
  utc_date: string | null;
  status: string | null;
  home_team: string | null;
  away_team: string | null;
  home_team_id: Numberish;
  away_team_id: Numberish;
  home_score: Numberish;
  away_score: Numberish;
  expected_home_goals: Numberish;
  expected_away_goals: Numberish;
  probability_over_15: Numberish;
  probability_over_25: Numberish;
  probability_over_35: Numberish;
  probability_btts_yes: Numberish;
  travel_distance_km: Numberish;
  raw_features?: JsonObject | null;
};

export type TeamStatSnapshotUpsertRow = {
  team_id: number;
  team_name: string;
  competition_id: string;
  competition_name: string;
  season: string;
  snapshot_date: string;
  source: string;
  matches_count: number;
  home_matches_count: number;
  away_matches_count: number;
  goals_for: number | null;
  goals_against: number | null;
  goals_for_per_game: number | null;
  goals_against_per_game: number | null;
  xg_for_per_game: number | null;
  xg_against_per_game: number | null;
  shots_for_per_game: null;
  shots_against_per_game: null;
  shots_on_target_for_per_game: null;
  shots_on_target_against_per_game: null;
  possession_avg: null;
  press_intensity: null;
  btts_rate: number | null;
  over15_rate: number | null;
  over25_rate: number | null;
  over35_rate: number | null;
  clean_sheet_rate: number | null;
  failed_to_score_rate: number | null;
  attack_strength: number | null;
  defense_strength: number | null;
  home_advantage: number | null;
  rest_days: number | null;
  fatigue_index: number | null;
  travel_distance_km: number | null;
  style_profile: JsonObject;
  form_snapshot: JsonObject;
  raw_source: JsonObject;
  updated_at: string;
};

export type TeamStatSnapshotBuildSummary = {
  sourceRows: number;
  appearances: number;
  snapshotsBuilt: number;
  teams: number;
  competitions: number;
  skippedMissingTeamId: number;
  skippedMissingDate: number;
  allCompetitionSnapshots: number;
};

export type TeamStatSnapshotBuildResult = {
  rows: TeamStatSnapshotUpsertRow[];
  summary: TeamStatSnapshotBuildSummary;
};

type Side = "home" | "away";

type Appearance = {
  matchId: number;
  sourceEventId: string | null;
  teamId: number;
  teamName: string;
  opponentName: string;
  competitionId: string;
  competitionName: string;
  season: string;
  side: Side;
  eventDate: string;
  eventTime: number;
  status: string | null;
  xgFor: number | null;
  xgAgainst: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  over15: number | null;
  over25: number | null;
  over35: number | null;
  btts: number | null;
  cleanSheet: number | null;
  failedToScore: number | null;
  travelDistanceKm: number | null;
  outcome: "W" | "D" | "L" | null;
};

type Accumulator = {
  teamId: number;
  teamName: string;
  competitionId: string;
  competitionName: string;
  season: string;
  appearances: Appearance[];
  homeCount: number;
  awayCount: number;
  actualCount: number;
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number[];
  xgAgainst: number[];
  homeXgFor: number[];
  awayXgFor: number[];
  btts: number[];
  over15: number[];
  over25: number[];
  over35: number[];
  cleanSheet: number[];
  failedToScore: number[];
  travelDistanceKm: number[];
};

type LeagueAccumulator = {
  xgFor: number[];
  xgAgainst: number[];
};

function toFiniteNumber(value: Numberish): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPositiveInteger(value: Numberish): number | null {
  const n = toFiniteNumber(value);
  if (n === null || n <= 0) return null;
  return Math.trunc(n);
}

function toScore(value: Numberish): number | null {
  const n = toFiniteNumber(value);
  if (n === null || n < 0) return null;
  return Math.trunc(n);
}

function toProbability(value: Numberish): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  const probability = n > 1 && n <= 100 ? n / 100 : n;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    return null;
  }
  return probability;
}

function avg(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, digits = 4) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCompetitionId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || "UNKNOWN";
}

function normalizeCompetitionName(value: string | null | undefined, id: string) {
  const normalized = String(value ?? "").trim();
  return normalized || id;
}

function isFinalStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").toUpperCase();
  return [
    "FINISHED",
    "COMPLETED",
    "FULL_TIME",
    "FT",
    "AET",
    "PEN",
    "AWARDED",
    "ENDED",
  ].includes(normalized);
}

function deriveSeason(dateIso: string) {
  const dt = new Date(dateIso);
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth() + 1;
  const start = month >= 7 ? year : year - 1;
  const end = start + 1;
  return `${start}/${String(end % 100).padStart(2, "0")}`;
}

function validDateIso(value: string | null | undefined) {
  if (!value) return null;
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toISOString();
}

function outcomeFromScores(
  goalsFor: number | null,
  goalsAgainst: number | null
): "W" | "D" | "L" | null {
  if (goalsFor === null || goalsAgainst === null) return null;
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";
  return "D";
}

function outcomeFromXg(
  xgFor: number | null,
  xgAgainst: number | null
): "W" | "D" | "L" | null {
  if (xgFor === null || xgAgainst === null) return null;
  const diff = xgFor - xgAgainst;
  if (Math.abs(diff) < 0.15) return "D";
  return diff > 0 ? "W" : "L";
}

function estimatedCleanSheetRate(xgAgainst: number | null) {
  if (xgAgainst === null) return null;
  return clamp(Math.exp(-xgAgainst), 0, 1);
}

function estimatedFailedToScoreRate(xgFor: number | null) {
  if (xgFor === null) return null;
  return clamp(Math.exp(-xgFor), 0, 1);
}

function rateFromActualOrProbability(
  actualValue: number | null,
  probabilityValue: number | null
) {
  return actualValue ?? probabilityValue;
}

function averageRestDays(eventTimes: number[]) {
  const uniqueTimes = Array.from(new Set(eventTimes)).sort((a, b) => a - b);
  if (uniqueTimes.length < 2) return null;

  const gaps = [];
  for (let i = 1; i < uniqueTimes.length; i += 1) {
    const days = (uniqueTimes[i] - uniqueTimes[i - 1]) / 86_400_000;
    if (days > 0.25) gaps.push(days);
  }

  return avg(gaps);
}

function fatigueFromRestDays(restDays: number | null) {
  if (restDays === null) return null;
  if (restDays <= 2) return 0.85;
  if (restDays <= 4) return 0.95;
  if (restDays >= 8) return 0.15;
  return round(1 - restDays / 8, 4);
}

function makeGroupKey(teamId: number, competitionId: string, season: string) {
  return `${teamId}|${competitionId}|${season}`;
}

function makeLeagueKey(competitionId: string, season: string) {
  return `${competitionId}|${season}`;
}

function getAccumulator(
  groups: Map<string, Accumulator>,
  appearance: Appearance,
  competitionId: string,
  competitionName: string
) {
  const key = makeGroupKey(appearance.teamId, competitionId, appearance.season);
  const existing = groups.get(key);
  if (existing) return existing;

  const created: Accumulator = {
    teamId: appearance.teamId,
    teamName: appearance.teamName,
    competitionId,
    competitionName,
    season: appearance.season,
    appearances: [],
    homeCount: 0,
    awayCount: 0,
    actualCount: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    xgFor: [],
    xgAgainst: [],
    homeXgFor: [],
    awayXgFor: [],
    btts: [],
    over15: [],
    over25: [],
    over35: [],
    cleanSheet: [],
    failedToScore: [],
    travelDistanceKm: [],
  };

  groups.set(key, created);
  return created;
}

function addNumber(target: number[], value: number | null) {
  if (value !== null && Number.isFinite(value)) target.push(value);
}

function addAppearance(acc: Accumulator, appearance: Appearance) {
  acc.appearances.push(appearance);
  if (appearance.side === "home") {
    acc.homeCount += 1;
    addNumber(acc.homeXgFor, appearance.xgFor);
  } else {
    acc.awayCount += 1;
    addNumber(acc.awayXgFor, appearance.xgFor);
  }

  if (appearance.goalsFor !== null && appearance.goalsAgainst !== null) {
    acc.actualCount += 1;
    acc.goalsFor += appearance.goalsFor;
    acc.goalsAgainst += appearance.goalsAgainst;
  }

  addNumber(acc.xgFor, appearance.xgFor);
  addNumber(acc.xgAgainst, appearance.xgAgainst);
  addNumber(acc.btts, appearance.btts);
  addNumber(acc.over15, appearance.over15);
  addNumber(acc.over25, appearance.over25);
  addNumber(acc.over35, appearance.over35);
  addNumber(acc.cleanSheet, appearance.cleanSheet);
  addNumber(acc.failedToScore, appearance.failedToScore);
  addNumber(acc.travelDistanceKm, appearance.travelDistanceKm);
}

function addLeagueSample(
  leagues: Map<string, LeagueAccumulator>,
  competitionId: string,
  season: string,
  xgFor: number | null,
  xgAgainst: number | null
) {
  const key = makeLeagueKey(competitionId, season);
  const existing = leagues.get(key) ?? { xgFor: [], xgAgainst: [] };
  addNumber(existing.xgFor, xgFor);
  addNumber(existing.xgAgainst, xgAgainst);
  leagues.set(key, existing);
}

function createAppearance(
  row: MatchPricingFeatureInputRow,
  side: Side,
  eventDate: string
): Appearance | null {
  const matchId = toPositiveInteger(row.match_id);
  const homeTeamId = toPositiveInteger(row.home_team_id);
  const awayTeamId = toPositiveInteger(row.away_team_id);
  const teamId = side === "home" ? homeTeamId : awayTeamId;
  const teamName = String(side === "home" ? row.home_team : row.away_team).trim();
  const opponentName = String(
    side === "home" ? row.away_team : row.home_team
  ).trim();

  if (matchId === null || teamId === null || !teamName || !opponentName) {
    return null;
  }

  const competitionId = normalizeCompetitionId(row.competition_id);
  const competitionName = normalizeCompetitionName(
    row.competition_name,
    competitionId
  );
  const homeXg = toFiniteNumber(row.expected_home_goals);
  const awayXg = toFiniteNumber(row.expected_away_goals);
  const xgFor = side === "home" ? homeXg : awayXg;
  const xgAgainst = side === "home" ? awayXg : homeXg;
  const homeScore = toScore(row.home_score);
  const awayScore = toScore(row.away_score);
  const hasActualScore =
    isFinalStatus(row.status) && homeScore !== null && awayScore !== null;
  const goalsFor = hasActualScore
    ? side === "home"
      ? homeScore
      : awayScore
    : null;
  const goalsAgainst = hasActualScore
    ? side === "home"
      ? awayScore
      : homeScore
    : null;
  const totalGoals = hasActualScore && homeScore !== null && awayScore !== null
    ? homeScore + awayScore
    : null;

  const actualOver15 = totalGoals === null ? null : totalGoals > 1.5 ? 1 : 0;
  const actualOver25 = totalGoals === null ? null : totalGoals > 2.5 ? 1 : 0;
  const actualOver35 = totalGoals === null ? null : totalGoals > 3.5 ? 1 : 0;
  const actualBtts =
    goalsFor === null || goalsAgainst === null
      ? null
      : goalsFor > 0 && goalsAgainst > 0
        ? 1
        : 0;
  const cleanSheet =
    goalsAgainst === null
      ? estimatedCleanSheetRate(xgAgainst)
      : goalsAgainst === 0
        ? 1
        : 0;
  const failedToScore =
    goalsFor === null
      ? estimatedFailedToScoreRate(xgFor)
      : goalsFor === 0
        ? 1
        : 0;
  const outcome =
    outcomeFromScores(goalsFor, goalsAgainst) ?? outcomeFromXg(xgFor, xgAgainst);

  return {
    matchId,
    sourceEventId: row.source_event_id ?? null,
    teamId,
    teamName,
    opponentName,
    competitionId,
    competitionName,
    season: deriveSeason(eventDate),
    side,
    eventDate,
    eventTime: new Date(eventDate).getTime(),
    status: row.status ?? null,
    xgFor,
    xgAgainst,
    goalsFor,
    goalsAgainst,
    over15: rateFromActualOrProbability(
      actualOver15,
      toProbability(row.probability_over_15)
    ),
    over25: rateFromActualOrProbability(
      actualOver25,
      toProbability(row.probability_over_25)
    ),
    over35: rateFromActualOrProbability(
      actualOver35,
      toProbability(row.probability_over_35)
    ),
    btts: rateFromActualOrProbability(
      actualBtts,
      toProbability(row.probability_btts_yes)
    ),
    cleanSheet,
    failedToScore,
    travelDistanceKm: toFiniteNumber(row.travel_distance_km),
    outcome,
  };
}

function toSnapshotRow(
  acc: Accumulator,
  leagueAvg: LeagueAccumulator | undefined,
  options: Required<BuildOptions>
): TeamStatSnapshotUpsertRow {
  const matchesCount = acc.appearances.length;
  const actualGoalsFor =
    acc.actualCount > 0 ? Math.round(acc.goalsFor) : null;
  const actualGoalsAgainst =
    acc.actualCount > 0 ? Math.round(acc.goalsAgainst) : null;
  const xgForPerGame = round(avg(acc.xgFor));
  const xgAgainstPerGame = round(avg(acc.xgAgainst));
  const leagueXgFor = avg(leagueAvg?.xgFor ?? []);
  const leagueXgAgainst = avg(leagueAvg?.xgAgainst ?? []);
  const attackStrength =
    xgForPerGame !== null && leagueXgFor !== null && leagueXgFor > 0
      ? round(clamp(xgForPerGame / leagueXgFor, 0.55, 1.75))
      : null;
  const defenseStrength =
    xgAgainstPerGame !== null && leagueXgAgainst !== null && leagueXgAgainst > 0
      ? round(clamp(xgAgainstPerGame / leagueXgAgainst, 0.55, 1.75))
      : null;
  const homeXg = avg(acc.homeXgFor);
  const awayXg = avg(acc.awayXgFor);
  const homeAdvantage =
    homeXg !== null && awayXg !== null && awayXg > 0
      ? round(clamp(homeXg / awayXg, 0.75, 1.35))
      : null;
  const restDays = round(
    averageRestDays(acc.appearances.map((appearance) => appearance.eventTime)),
    2
  );
  const recentForm = [...acc.appearances]
    .sort((a, b) => b.eventTime - a.eventTime)
    .slice(0, 8)
    .map((appearance) => ({
      matchId: appearance.matchId,
      sourceEventId: appearance.sourceEventId,
      date: appearance.eventDate.slice(0, 10),
      side: appearance.side,
      opponent: appearance.opponentName,
      outcome: appearance.outcome,
      goalsFor: appearance.goalsFor,
      goalsAgainst: appearance.goalsAgainst,
      xgFor: round(appearance.xgFor),
      xgAgainst: round(appearance.xgAgainst),
      status: appearance.status,
    }));

  return {
    team_id: acc.teamId,
    team_name: acc.teamName,
    competition_id: acc.competitionId,
    competition_name: acc.competitionName,
    season: acc.season,
    snapshot_date: options.snapshotDate,
    source: options.source,
    matches_count: matchesCount,
    home_matches_count: acc.homeCount,
    away_matches_count: acc.awayCount,
    goals_for: actualGoalsFor,
    goals_against: actualGoalsAgainst,
    goals_for_per_game:
      acc.actualCount > 0 ? round(acc.goalsFor / acc.actualCount) : null,
    goals_against_per_game:
      acc.actualCount > 0 ? round(acc.goalsAgainst / acc.actualCount) : null,
    xg_for_per_game: xgForPerGame,
    xg_against_per_game: xgAgainstPerGame,
    shots_for_per_game: null,
    shots_against_per_game: null,
    shots_on_target_for_per_game: null,
    shots_on_target_against_per_game: null,
    possession_avg: null,
    press_intensity: null,
    btts_rate: round(avg(acc.btts)),
    over15_rate: round(avg(acc.over15)),
    over25_rate: round(avg(acc.over25)),
    over35_rate: round(avg(acc.over35)),
    clean_sheet_rate: round(avg(acc.cleanSheet)),
    failed_to_score_rate: round(avg(acc.failedToScore)),
    attack_strength: attackStrength,
    defense_strength: defenseStrength,
    home_advantage: homeAdvantage,
    rest_days: restDays,
    fatigue_index: fatigueFromRestDays(restDays),
    travel_distance_km: round(avg(acc.travelDistanceKm), 2),
    style_profile: {
      modelVersion: TEAM_STATS_MODEL_VERSION,
      basis:
        acc.actualCount > 0
          ? "mixed_actual_scores_and_bsd_features"
          : "bsd_feature_snapshots",
      xgSamples: acc.xgFor.length,
      probabilitySamples: {
        btts: acc.btts.length,
        over15: acc.over15.length,
        over25: acc.over25.length,
        over35: acc.over35.length,
      },
      rates: {
        btts: round(avg(acc.btts)),
        over15: round(avg(acc.over15)),
        over25: round(avg(acc.over25)),
        over35: round(avg(acc.over35)),
      },
      strength: {
        attack: attackStrength,
        defense: defenseStrength,
        homeAdvantage,
      },
    },
    form_snapshot: {
      modelVersion: TEAM_STATS_MODEL_VERSION,
      recent: recentForm,
      actualMatchesCount: acc.actualCount,
      inferredMatchesCount: matchesCount - acc.actualCount,
    },
    raw_source: {
      modelVersion: TEAM_STATS_MODEL_VERSION,
      generatedAt: options.generatedAt,
      sourceTable: "match_pricing_features",
      sourceRows: matchesCount,
      actualMatchesCount: acc.actualCount,
      matchIds: acc.appearances.map((appearance) => appearance.matchId).slice(0, 80),
      truncatedMatchIds: matchesCount > 80,
    },
    updated_at: options.generatedAt,
  };
}

type BuildOptions = {
  snapshotDate: string;
  source?: string;
  generatedAt?: string;
  includeAllCompetitions?: boolean;
};

function normalizeOptions(options: BuildOptions): Required<BuildOptions> {
  return {
    snapshotDate: options.snapshotDate,
    source: options.source ?? "bsd",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    includeAllCompetitions: options.includeAllCompetitions ?? true,
  };
}

export function buildTeamStatSnapshotsFromPricingFeatures(
  rows: MatchPricingFeatureInputRow[],
  buildOptions: BuildOptions
): TeamStatSnapshotBuildResult {
  const options = normalizeOptions(buildOptions);
  const groups = new Map<string, Accumulator>();
  const leagues = new Map<string, LeagueAccumulator>();
  const teamIds = new Set<number>();
  const competitionIds = new Set<string>();
  let appearances = 0;
  let skippedMissingTeamId = 0;
  let skippedMissingDate = 0;

  for (const row of rows) {
    const eventDate = validDateIso(row.utc_date);
    if (!eventDate) {
      skippedMissingDate += 1;
      continue;
    }

    for (const side of ["home", "away"] as const) {
      const appearance = createAppearance(row, side, eventDate);
      if (!appearance) {
        skippedMissingTeamId += 1;
        continue;
      }

      appearances += 1;
      teamIds.add(appearance.teamId);
      competitionIds.add(appearance.competitionId);

      const exact = getAccumulator(
        groups,
        appearance,
        appearance.competitionId,
        appearance.competitionName
      );
      addAppearance(exact, appearance);
      addLeagueSample(
        leagues,
        appearance.competitionId,
        appearance.season,
        appearance.xgFor,
        appearance.xgAgainst
      );

      if (options.includeAllCompetitions) {
        const all = getAccumulator(
          groups,
          appearance,
          ALL_COMPETITIONS_ID,
          ALL_COMPETITIONS_NAME
        );
        addAppearance(all, appearance);
        addLeagueSample(
          leagues,
          ALL_COMPETITIONS_ID,
          appearance.season,
          appearance.xgFor,
          appearance.xgAgainst
        );
      }
    }
  }

  const snapshotRows = Array.from(groups.values())
    .map((acc) =>
      toSnapshotRow(acc, leagues.get(makeLeagueKey(acc.competitionId, acc.season)), options)
    )
    .sort((a, b) => {
      if (a.team_name !== b.team_name) return a.team_name.localeCompare(b.team_name);
      if (a.competition_id !== b.competition_id) {
        return a.competition_id.localeCompare(b.competition_id);
      }
      return a.season.localeCompare(b.season);
    });

  return {
    rows: snapshotRows,
    summary: {
      sourceRows: rows.length,
      appearances,
      snapshotsBuilt: snapshotRows.length,
      teams: teamIds.size,
      competitions: competitionIds.size,
      skippedMissingTeamId,
      skippedMissingDate,
      allCompetitionSnapshots: snapshotRows.filter(
        (row) => row.competition_id === ALL_COMPETITIONS_ID
      ).length,
    },
  };
}
