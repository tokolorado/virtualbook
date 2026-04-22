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

alter table public.system_check_runs enable row level security;
alter table public.system_check_results enable row level security;

create or replace function public.run_system_check_suite(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 20), 1);
  v_checks jsonb := '[]'::jsonb;
  v_rows_count integer := 0;
  v_sample jsonb := '[]'::jsonb;
  v_ok boolean := true;
  v_checks_total integer := 0;
  v_checks_passed integer := 0;
  v_checks_failed integer := 0;
begin
  -- 1. profile balance vs latest ledger
  with q as (
    with last_ledger as (
      select distinct on (l.user_id)
        l.user_id,
        l.balance_after,
        l.created_at,
        l.id
      from public.vb_ledger l
      order by l.user_id, l.created_at desc, l.id desc
    )
    select
      p.id as user_id,
      p.balance_vb as profile_balance,
      ll.balance_after as ledger_balance_after,
      round(coalesce(p.balance_vb, 0) - coalesce(ll.balance_after, 0), 2) as diff
    from public.profiles p
    left join last_ledger ll
      on ll.user_id = p.id
    where round(coalesce(p.balance_vb, 0) - coalesce(ll.balance_after, 0), 2) <> 0
    order by abs(coalesce(p.balance_vb, 0) - coalesce(ll.balance_after, 0)) desc
  ),
  stats as (
    select count(*)::int as cnt from q
  ),
  sampled as (
    select * from q limit v_limit
  )
  select
    coalesce((select cnt from stats), 0),
    coalesce((select jsonb_agg(to_jsonb(s)) from sampled s), '[]'::jsonb)
  into v_rows_count, v_sample;

  v_ok := v_rows_count = 0;
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'wallet_balance_vs_latest_ledger',
      'severity', 'critical',
      'ok', v_ok,
      'rowsCount', v_rows_count,
      'sample', v_sample,
      'details', jsonb_build_object()
    )
  );

  -- 2. duplicate payout/refund rows
  with q as (
    select
      l.ref_id as bet_id,
      l.kind,
      count(*) as rows_count,
      sum(l.amount) as amount_sum
    from public.vb_ledger l
    where l.ref_type = 'bet'
      and l.kind in ('BET_PAYOUT', 'BET_REFUND')
    group by l.ref_id, l.kind
    having count(*) > 1
    order by count(*) desc, l.ref_id
  ),
  stats as (
    select count(*)::int as cnt from q
  ),
  sampled as (
    select * from q limit v_limit
  )
  select
    coalesce((select cnt from stats), 0),
    coalesce((select jsonb_agg(to_jsonb(s)) from sampled s), '[]'::jsonb)
  into v_rows_count, v_sample;

  v_ok := v_rows_count = 0;
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'duplicate_bet_payout_or_refund',
      'severity', 'critical',
      'ok', v_ok,
      'rowsCount', v_rows_count,
      'sample', v_sample,
      'details', jsonb_build_object()
    )
  );

  -- 3. unsettled bets with payout/refund
  with q as (
    select
      b.id as bet_id,
      b.user_id,
      b.status,
      b.settled,
      count(*) filter (where l.kind = 'BET_PAYOUT') as payout_rows,
      count(*) filter (where l.kind = 'BET_REFUND') as refund_rows,
      sum(case when l.kind = 'BET_PAYOUT' then l.amount else 0 end) as payout_sum,
      sum(case when l.kind = 'BET_REFUND' then l.amount else 0 end) as refund_sum
    from public.bets b
    join public.vb_ledger l
      on l.ref_type = 'bet'
     and l.ref_id = b.id::text
    where b.settled = false
      and l.kind in ('BET_PAYOUT', 'BET_REFUND')
    group by b.id, b.user_id, b.status, b.settled, b.created_at
    order by b.created_at desc
  ),
  stats as (
    select count(*)::int as cnt from q
  ),
  sampled as (
    select * from q limit v_limit
  )
  select
    coalesce((select cnt from stats), 0),
    coalesce((select jsonb_agg(to_jsonb(s)) from sampled s), '[]'::jsonb)
  into v_rows_count, v_sample;

  v_ok := v_rows_count = 0;
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'unsettled_bets_with_payout_or_refund',
      'severity', 'critical',
      'ok', v_ok,
      'rowsCount', v_rows_count,
      'sample', v_sample,
      'details', jsonb_build_object()
    )
  );

  -- 4. won settled bet without payout ledger
  with q as (
    select
      b.id as bet_id,
      b.user_id,
      b.status,
      b.settled,
      b.payout
    from public.bets b
    left join public.vb_ledger l
      on l.ref_type = 'bet'
     and l.ref_id = b.id::text
     and l.kind = 'BET_PAYOUT'
    where b.settled = true
      and lower(coalesce(b.status, '')) = 'won'
      and coalesce(b.payout, 0) > 0
    group by b.id, b.user_id, b.status, b.settled, b.payout, b.created_at
    having count(l.id) = 0
    order by b.created_at desc
  ),
  stats as (
    select count(*)::int as cnt from q
  ),
  sampled as (
    select * from q limit v_limit
  )
  select
    coalesce((select cnt from stats), 0),
    coalesce((select jsonb_agg(to_jsonb(s)) from sampled s), '[]'::jsonb)
  into v_rows_count, v_sample;

  v_ok := v_rows_count = 0;
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'won_bets_missing_payout_ledger',
      'severity', 'critical',
      'ok', v_ok,
      'rowsCount', v_rows_count,
      'sample', v_sample,
      'details', jsonb_build_object()
    )
  );

  -- 5. duplicate bet items
  with q as (
    select
      bi.bet_id,
      bi.match_id_bigint,
      bi.market,
      bi.pick,
      count(*) as dup_count
    from public.bet_items bi
    group by
      bi.bet_id,
      bi.match_id_bigint,
      bi.market,
      bi.pick
    having count(*) > 1
    order by dup_count desc, bi.bet_id
  ),
  stats as (
    select count(*)::int as cnt from q
  ),
  sampled as (
    select * from q limit v_limit
  )
  select
    coalesce((select cnt from stats), 0),
    coalesce((select jsonb_agg(to_jsonb(s)) from sampled s), '[]'::jsonb)
  into v_rows_count, v_sample;

  v_ok := v_rows_count = 0;
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'duplicate_bet_items',
      'severity', 'critical',
      'ok', v_ok,
      'rowsCount', v_rows_count,
      'sample', v_sample,
      'details', jsonb_build_object()
    )
  );

  -- 6. fully resolved items but bet still unsettled
  with q as (
    with item_status as (
      select
        bi.bet_id,
        count(*) as items_total,
        count(*) filter (
          where bi.settled = true
            and lower(coalesce(bi.result, '')) in ('won', 'lost', 'void')
        ) as items_resolved
      from public.bet_items bi
      group by bi.bet_id
    )
    select
      b.id as bet_id,
      b.status,
      b.settled,
      i.items_total,
      i.items_resolved
    from public.bets b
    join item_status i
      on i.bet_id = b.id
    where b.settled = false
      and i.items_total > 0
      and i.items_total = i.items_resolved
    order by b.created_at desc
  ),
  stats as (
    select count(*)::int as cnt from q
  ),
  sampled as (
    select * from q limit v_limit
  )
  select
    coalesce((select cnt from stats), 0),
    coalesce((select jsonb_agg(to_jsonb(s)) from sampled s), '[]'::jsonb)
  into v_rows_count, v_sample;

  v_ok := v_rows_count = 0;
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'resolved_items_but_unsettled_bet',
      'severity', 'warning',
      'ok', v_ok,
      'rowsCount', v_rows_count,
      'sample', v_sample,
      'details', jsonb_build_object()
    )
  );

  -- 7. total odds mismatch
  with q as (
    with item_prod as (
      select
        bi.bet_id,
        round(exp(sum(ln(bi.odds::float8)))::numeric, 2) as item_total_odds
      from public.bet_items bi
      group by bi.bet_id
    )
    select
      b.id as bet_id,
      b.total_odds as bet_total_odds,
      i.item_total_odds,
      round(coalesce(b.total_odds, 0) - coalesce(i.item_total_odds, 0), 2) as diff
    from public.bets b
    join item_prod i
      on i.bet_id = b.id
    where round(coalesce(b.total_odds, 0) - coalesce(i.item_total_odds, 0), 2) <> 0
    order by b.created_at desc
  ),
  stats as (
    select count(*)::int as cnt from q
  ),
  sampled as (
    select * from q limit v_limit
  )
  select
    coalesce((select cnt from stats), 0),
    coalesce((select jsonb_agg(to_jsonb(s)) from sampled s), '[]'::jsonb)
  into v_rows_count, v_sample;

  v_ok := v_rows_count = 0;
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'bet_total_odds_mismatch',
      'severity', 'warning',
      'ok', v_ok,
      'rowsCount', v_rows_count,
      'sample', v_sample,
      'details', jsonb_build_object()
    )
  );

  -- 8. finished matches with still-open items
  with q as (
    select
      m.id as match_id,
      m.status,
      count(*) filter (
        where bi.settled = false or bi.result is null
      ) as open_items
    from public.matches m
    join public.bet_items bi
      on bi.match_id_bigint = m.id
    where m.status = 'FINISHED'
    group by m.id, m.status, m.utc_date
    having count(*) filter (
      where bi.settled = false or bi.result is null
    ) > 0
    order by m.utc_date desc
  ),
  stats as (
    select count(*)::int as cnt from q
  ),
  sampled as (
    select * from q limit v_limit
  )
  select
    coalesce((select cnt from stats), 0),
    coalesce((select jsonb_agg(to_jsonb(s)) from sampled s), '[]'::jsonb)
  into v_rows_count, v_sample;

  v_ok := v_rows_count = 0;
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'finished_matches_with_unsettled_items',
      'severity', 'warning',
      'ok', v_ok,
      'rowsCount', v_rows_count,
      'sample', v_sample,
      'details', jsonb_build_object()
    )
  );

  -- 9. failed match settlements
  with q as (
    select
      ms.match_id,
      ms.status,
      ms.started_at,
      ms.finished_at,
      ms.error
    from public.match_settlements ms
    where ms.status = 'failed'
    order by ms.started_at desc
  ),
  stats as (
    select count(*)::int as cnt from q
  ),
  sampled as (
    select * from q limit v_limit
  )
  select
    coalesce((select cnt from stats), 0),
    coalesce((select jsonb_agg(to_jsonb(s)) from sampled s), '[]'::jsonb)
  into v_rows_count, v_sample;

  v_ok := v_rows_count = 0;
  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'failed_match_settlements',
      'severity', 'warning',
      'ok', v_ok,
      'rowsCount', v_rows_count,
      'sample', v_sample,
      'details', jsonb_build_object()
    )
  );

  v_checks_total := jsonb_array_length(v_checks);

  select count(*)::int
  into v_checks_passed
  from jsonb_array_elements(v_checks) e
  where coalesce((e->>'ok')::boolean, false) = true;

  v_checks_failed := v_checks_total - v_checks_passed;

  return jsonb_build_object(
    'ok', v_checks_failed = 0,
    'generatedAt', now(),
    'checksTotal', v_checks_total,
    'checksPassed', v_checks_passed,
    'checksFailed', v_checks_failed,
    'checks', v_checks
  );
end;
$$;

revoke all on function public.run_system_check_suite(integer) from public, anon, authenticated;
grant execute on function public.run_system_check_suite(integer) to postgres;