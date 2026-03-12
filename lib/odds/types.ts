// lib/odds/types.ts

export type OddsRowDb = {
  match_id: number;
  market_id: string;
  selection: string;
  margin: number;
  risk_adjustment: number;
  updated_at: string;
  home_team: string | null;
  away_team: string | null;
  fair_prob: number;
  fair_odds: number;
  book_prob: number;
  book_odds: number;
  engine_version: string;
};

export type TeamRow = {
  teamId: number;
  playedGames: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type StandingsCtx = {
  byTeamId: Map<number, TeamRow>;
  leagueAvgGoalsFor: number;
  leagueAvgGoalsAgainst: number;
};

export type TeamRatingRow = {
  teamId: number;
  competitionId: string;
  overallRating: number;
  attackRating: number;
  defenseRating: number;
  formRating: number;
  matchesCount: number;
  ratingDate: string | null;
};

export type TeamRatingsCtx = {
  byCompetitionTeam: Map<string, TeamRatingRow>;
};

export type MatchInput = {
  matchId: number;
  competitionId: string | null;
  homeId: number | null;
  awayId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
};

export type EngineContext = {
  standingsCtx: StandingsCtx | null;
  homeRatingRow: any | null;
  awayRatingRow: any | null;
};

export type EngineConfig = {
  nowIso: string;
  margin: number;
  maxGoals: number;
  homeAdv: number;
  drawBoost: number;
};

export type EngineResult = {
  engineVersion: string;
  rows: OddsRowDb[];
};