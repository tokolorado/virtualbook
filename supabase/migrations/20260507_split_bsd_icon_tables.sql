begin;

create table if not exists public.icons_leagues (
  provider text not null default 'bsd',
  provider_league_id text not null,
  app_code text,
  league_name text not null,
  country text,
  icon_url text not null,
  source text not null default 'bsd',
  raw jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint icons_leagues_pkey primary key (provider, provider_league_id)
);

create unique index if not exists icons_leagues_provider_app_code_idx
  on public.icons_leagues (provider, app_code)
  where app_code is not null;

create index if not exists icons_leagues_app_code_idx
  on public.icons_leagues (app_code);

create table if not exists public.icons_teams (
  provider text not null default 'bsd',
  provider_team_id bigint not null,
  team_name text not null,
  short_name text,
  country text,
  icon_url text not null,
  source text not null default 'bsd',
  raw jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint icons_teams_pkey primary key (provider, provider_team_id)
);

create index if not exists icons_teams_team_name_idx
  on public.icons_teams (team_name);

insert into public.icons_leagues (
  provider,
  provider_league_id,
  app_code,
  league_name,
  country,
  icon_url,
  source,
  raw,
  last_sync_at,
  updated_at
)
select
  pl.provider,
  pl.provider_league_id::text,
  pl.app_code,
  pl.name,
  pl.country,
  pl.logo_url,
  'bsd',
  coalesce(pl.raw, '{}'::jsonb),
  coalesce(pl.updated_at, now()),
  coalesce(pl.updated_at, now())
from public.provider_leagues pl
where pl.provider = 'bsd'
  and pl.provider_league_id is not null
  and nullif(trim(coalesce(pl.logo_url, '')), '') is not null
on conflict (provider, provider_league_id) do update
set
  app_code = excluded.app_code,
  league_name = excluded.league_name,
  country = excluded.country,
  icon_url = excluded.icon_url,
  source = excluded.source,
  raw = excluded.raw,
  last_sync_at = excluded.last_sync_at,
  updated_at = excluded.updated_at;

insert into public.icons_teams (
  provider,
  provider_team_id,
  team_name,
  short_name,
  country,
  icon_url,
  source,
  last_sync_at,
  updated_at
)
select
  'bsd',
  t.id,
  t.name,
  t.short_name,
  t.area_name,
  t.crest,
  'bsd',
  t.last_sync_at,
  t.last_sync_at
from public.teams t
where nullif(trim(coalesce(t.crest, '')), '') is not null
on conflict (provider, provider_team_id) do update
set
  team_name = excluded.team_name,
  short_name = excluded.short_name,
  country = excluded.country,
  icon_url = excluded.icon_url,
  source = excluded.source,
  last_sync_at = excluded.last_sync_at,
  updated_at = excluded.updated_at;

update public.provider_leagues
set
  fallback_provider = null,
  fallback_code = null,
  updated_at = now()
where fallback_provider is not null
   or fallback_code is not null;

commit;
