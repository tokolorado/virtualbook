begin;

alter table public.matches drop constraint if exists matches_competition_id_check;

alter table public.matches
  add column if not exists source text,
  add column if not exists source_event_id text,
  add column if not exists source_league_id text,
  add column if not exists source_season_id text,
  add column if not exists source_status text,
  add column if not exists source_round_name text,
  add column if not exists group_name text,
  add column if not exists minute integer,
  add column if not exists injury_time integer,
  add column if not exists home_short_name text,
  add column if not exists away_short_name text,
  add column if not exists home_country text,
  add column if not exists away_country text,
  add column if not exists venue_id bigint,
  add column if not exists venue_name text,
  add column if not exists venue_city text,
  add column if not exists venue_country text,
  add column if not exists venue_capacity integer,
  add column if not exists venue_latitude double precision,
  add column if not exists venue_longitude double precision,
  add column if not exists home_coach_name text,
  add column if not exists away_coach_name text,
  add column if not exists referee text,
  add column if not exists is_neutral_ground boolean,
  add column if not exists is_local_derby boolean,
  add column if not exists travel_distance_km double precision,
  add column if not exists weather_code text,
  add column if not exists wind_speed double precision,
  add column if not exists temperature_c double precision,
  add column if not exists pitch_condition text,
  add column if not exists attendance integer,
  add column if not exists raw_bsd jsonb;

alter table public.odds
  add column if not exists source text,
  add column if not exists source_event_id text,
  add column if not exists pricing_method text,
  add column if not exists raw_count integer,
  add column if not exists provider_fetched_at timestamptz,
  add column if not exists raw_source jsonb,
  add column if not exists implied_probability double precision,
  add column if not exists is_model boolean not null default false;

create table if not exists public.provider_leagues (
  provider text not null,
  app_code text not null,
  provider_league_id bigint not null,
  provider_season_id bigint,
  name text not null,
  normalized_name text not null,
  country text,
  is_women boolean not null default false,
  current_season_name text,
  current_season_year integer,
  current_season_start_date date,
  current_season_end_date date,
  enabled boolean not null default true,
  sort_order integer not null default 999,
  fallback_provider text,
  fallback_code text,
  logo_url text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_leagues_pkey primary key (provider, app_code)
);

create table if not exists public.event_predictions (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches(id) on delete cascade,
  source text not null,
  market text not null,
  predicted_home_score integer,
  predicted_away_score integer,
  predicted_score text,
  predicted_result text,
  predicted_label text,
  expected_home_goals double precision,
  expected_away_goals double precision,
  probability_home_win double precision,
  probability_draw double precision,
  probability_away_win double precision,
  probability_over_15 double precision,
  probability_over_25 double precision,
  probability_over_35 double precision,
  probability_btts_yes double precision,
  confidence double precision,
  model_version text,
  source_prediction_id text,
  source_event_id text,
  source_league_id text,
  source_league_name text,
  source_home_team_id text,
  source_away_team_id text,
  source_home_team_name text,
  source_away_team_name text,
  source_event_date timestamptz,
  match_confidence text,
  match_score double precision,
  source_payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_predictions_match_source_market_uidx unique (match_id, source, market)
);

create table if not exists public.bsd_event_features (
  match_id bigint primary key references public.matches(id) on delete cascade,
  source text not null default 'bsd',
  source_event_id text,
  competition_id text,
  competition_name text,
  utc_date timestamptz,
  status text,
  home_team text,
  away_team text,
  home_team_id bigint,
  away_team_id bigint,
  model_version text,
  home_xg double precision,
  away_xg double precision,
  total_xg double precision,
  home_win_prob double precision,
  draw_prob double precision,
  away_win_prob double precision,
  over25_prob double precision,
  btts_prob double precision,
  unavailable_home_count integer,
  unavailable_away_count integer,
  injured_home_count integer,
  injured_away_count integer,
  doubtful_home_count integer,
  doubtful_away_count integer,
  live_home_xg double precision,
  live_away_xg double precision,
  live_home_shots integer,
  live_away_shots integer,
  live_home_shots_on_target integer,
  live_away_shots_on_target integer,
  live_home_possession double precision,
  live_away_possession double precision,
  features jsonb not null default '{}'::jsonb,
  raw_unavailable_players jsonb,
  raw_live_stats jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.match_pricing_features (
  match_id bigint primary key references public.matches(id) on delete cascade,
  source text not null default 'bsd',
  source_event_id text,
  competition_id text,
  competition_name text,
  utc_date timestamptz,
  status text,
  home_team text,
  away_team text,
  home_team_id bigint,
  away_team_id bigint,
  home_score integer,
  away_score integer,
  expected_home_goals double precision,
  expected_away_goals double precision,
  probability_home_win double precision,
  probability_draw double precision,
  probability_away_win double precision,
  probability_over_15 double precision,
  probability_over_25 double precision,
  probability_over_35 double precision,
  probability_btts_yes double precision,
  is_neutral_ground boolean,
  is_local_derby boolean,
  travel_distance_km double precision,
  weather_code text,
  wind_speed double precision,
  temperature_c double precision,
  pitch_condition text,
  attendance integer,
  generated_odds_count integer not null default 0,
  model_version text,
  last_priced_at timestamptz,
  last_sync_at timestamptz,
  raw_features jsonb not null default '{}'::jsonb
);

create table if not exists public.team_stat_snapshots (
  id bigint generated always as identity primary key,
  team_id bigint not null,
  team_name text not null,
  competition_id text,
  competition_name text,
  season text,
  snapshot_date date not null,
  source text not null default 'bsd',
  matches_count integer not null default 0,
  home_matches_count integer not null default 0,
  away_matches_count integer not null default 0,
  goals_for integer,
  goals_against integer,
  goals_for_per_game double precision,
  goals_against_per_game double precision,
  xg_for_per_game double precision,
  xg_against_per_game double precision,
  shots_for_per_game double precision,
  shots_against_per_game double precision,
  shots_on_target_for_per_game double precision,
  shots_on_target_against_per_game double precision,
  possession_avg double precision,
  press_intensity double precision,
  btts_rate double precision,
  over15_rate double precision,
  over25_rate double precision,
  over35_rate double precision,
  clean_sheet_rate double precision,
  failed_to_score_rate double precision,
  attack_strength double precision,
  defense_strength double precision,
  home_advantage double precision,
  rest_days double precision,
  fatigue_index double precision,
  travel_distance_km double precision,
  style_profile jsonb not null default '{}'::jsonb,
  form_snapshot jsonb not null default '{}'::jsonb,
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_stat_snapshots_unique unique (team_id, competition_id, season, snapshot_date, source)
);

create table if not exists public.team_availability_snapshots (
  id bigint generated always as identity primary key,
  team_id bigint not null,
  team_name text not null,
  match_id bigint references public.matches(id) on delete cascade,
  snapshot_date date not null,
  unavailable_count integer not null default 0,
  injured_count integer not null default 0,
  suspended_count integer not null default 0,
  doubtful_count integer not null default 0,
  unavailable_players jsonb not null default '[]'::jsonb,
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint team_availability_snapshots_unique unique (team_id, match_id, snapshot_date)
);

create table if not exists public.team_match_context_snapshots (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches(id) on delete cascade,
  team_id bigint not null,
  side text not null check (side in ('home', 'away')),
  rest_days double precision,
  travel_distance_km double precision,
  neutral_ground boolean,
  local_derby boolean,
  venue_id bigint,
  weather_code text,
  temperature_c double precision,
  wind_speed double precision,
  pitch_condition text,
  raw_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint team_match_context_snapshots_unique unique (match_id, team_id, side)
);

create table if not exists public.internal_odds_model_runs (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches(id) on delete cascade,
  model_version text not null,
  status text not null,
  confidence double precision,
  lambda_home double precision,
  lambda_away double precision,
  input_snapshot jsonb not null default '{}'::jsonb,
  output_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists matches_source_utc_date_idx
  on public.matches (source, utc_date);

create index if not exists matches_source_event_idx
  on public.matches (source, source_event_id);

create index if not exists odds_displayable_bsd_idx
  on public.odds (match_id, market_id, selection)
  where source = 'bsd' and pricing_method = 'bsd_market_normalized';

create index if not exists odds_internal_fallback_idx
  on public.odds (match_id, market_id, selection)
  where source = 'internal_model' and pricing_method = 'internal_model_fallback';

create index if not exists event_predictions_match_idx
  on public.event_predictions (match_id, source, market);

create index if not exists team_stat_snapshots_lookup_idx
  on public.team_stat_snapshots (team_id, snapshot_date desc);

create index if not exists team_stat_snapshots_competition_idx
  on public.team_stat_snapshots (competition_id, season, snapshot_date desc);

commit;
