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

  // snake_case compatibility
  team_id?: number;
  played_games?: number;
  goals_for?: number;
  goals_against?: number;
};

export type StandingsCtx = {
  byTeamId: Map<number, TeamRow>;
  leagueAvgGoalsFor: number;
  leagueAvgGoalsAgainst: number;

  // snake_case compatibility
  league_avg_goals_for?: number;
  league_avg_goals_against?: number;
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

  // snake_case compatibility for older engine-v1 code
  team_id?: number;
  competition_id?: string;
  overall_rating?: number;
  attack_rating?: number;
  defense_rating?: number;
  form_rating?: number;
  matches_count?: number;
  rating_date?: string | null;
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

  // snake_case compatibility
  match_id?: number;
  competition_id?: string | null;
  home_id?: number | null;
  away_id?: number | null;
  home_team?: string | null;
  away_team?: string | null;
};

export type EngineContext = {
  standingsCtx: StandingsCtx | null;
  homeRatingRow: TeamRatingRow | null;
  awayRatingRow: TeamRatingRow | null;
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