create table if not exists public.system_check_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  started_by uuid,
  source text not null default 'admin_manual',
  status text not null default 'running'
    check (status in ('running', 'success', 'failed')),
  ok boolean,
  checks_total integer not null default 0,
  checks_passed integer not null default 0,
  checks_failed integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error text
);

create table if not exists public.system_check_results (
  id bigserial primary key,
  run_id bigint not null references public.system_check_runs(id) on delete cascade,
  check_key text not null,
  severity text not null
    check (severity in ('info', 'warning', 'critical')),
  ok boolean not null,
  rows_count integer not null default 0,
  sample jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_check_runs_started_at_idx
  on public.system_check_runs(started_at desc);

create index if not exists system_check_results_run_id_idx
  on public.system_check_results(run_id);

create index if not exists system_check_results_check_key_idx
  on public.system_check_results(check_key);