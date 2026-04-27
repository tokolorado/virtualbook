-- Snapshot of selected public function definitions exported from Supabase production.
-- Generated from: Supabase Snippet Inspect Public Function Definitions.csv
-- Date: 2026-04-27
--
-- This file is an audit snapshot, not a migration.
-- Privileges are not included in pg_get_functiondef output; keep grants/revokes in migrations.

-- ============================================================================
-- Function: public.apply_vb_transaction(uuid, numeric, text, text, text)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.apply_vb_transaction(p_user_id uuid, p_amount numeric, p_kind text, p_ref_type text, p_ref_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$--apply_vb_transaction
declare
  v_balance numeric(12,2);
  v_amount  numeric(12,2);
  v_new_balance numeric(12,2);
  v_ledger_id uuid;
begin
  if p_amount is null or p_amount = 0 then
    return;
  end if;

  -- zawsze pracujemy na 2 miejscach
  v_amount := round(p_amount, 2);

  -- lock profilu
  select balance_vb
    into v_balance
  from public.profiles
  where id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'Profile not found for user_id=%', p_user_id;
  end if;

  v_new_balance := round(v_balance + v_amount, 2);

  if v_new_balance < 0 then
    raise exception 'Negative balance not allowed. user_id=%, balance=%, amount=%',
      p_user_id, v_balance, v_amount;
  end if;

  insert into public.vb_ledger (user_id, amount, kind, ref_type, ref_id, balance_after)
  values (p_user_id, v_amount, p_kind, p_ref_type, p_ref_id, v_new_balance)
  on conflict (user_id, ref_type, ref_id, kind) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    return;
  end if;

  update public.profiles
  set balance_vb     = v_new_balance,
      last_ledger_id = v_ledger_id,
      last_tx_amount = v_amount,
      last_tx_at     = now()
  where id = p_user_id;
end;$function$
;

-- ============================================================================
-- Function: public.grant_weekly_vb(numeric)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.grant_weekly_vb(p_amount numeric DEFAULT 200)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- p_amount is kept only for signature compatibility; weekly grant is fixed.
  v_grant_amount numeric := 200;
  v_week_id text := to_char((now() at time zone 'utc')::date, 'IYYY-"W"IW');
  v_ref_id text := 'weekly_' || v_week_id;
  r record;
begin
  for r in
    select id
    from public.profiles
  loop
    perform public.apply_vb_transaction(
      r.id,
      v_grant_amount,
      'WEEKLY_GRANT',
      'weekly',
      v_ref_id
    );
  end loop;
end;
$function$
;

-- ============================================================================
-- Function: public.place_bet(numeric, jsonb, uuid)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.place_bet(p_stake numeric, p_items jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();

  v_stake numeric(12,2);
  v_total_odds numeric(12,2);
  v_potential_win numeric(12,2);
  v_balance_after numeric(12,2);

  v_bet_id uuid;
  v_response jsonb;
  v_request_hash text;

  v_existing_hash text;
  v_existing_response jsonb;

  v_items_count integer := 0;
  v_invalid_items integer := 0;
  v_matched_count integer := 0;
  v_open_count integer := 0;
  v_priced_count integer := 0;
  v_distinct_items integer := 0;

  v_current_balance numeric(12,2);

  v_validated_rows jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_request_id is null then
    raise exception 'Missing request id';
  end if;

  if p_stake is null or p_stake <= 0 then
    raise exception 'Invalid stake';
  end if;

  v_stake := round(p_stake, 2);

  if v_stake > 10000 then
    raise exception 'Stake exceeds limit';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Slip is empty';
  end if;

  if jsonb_array_length(p_items) > 20 then
    raise exception 'Too many items';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and coalesce(p.is_banned, false) = true
  ) then
    raise exception 'User is banned';
  end if;

  v_request_hash := public.make_bet_request_hash(v_stake, p_items);

  perform pg_advisory_xact_lock(
    hashtext('place_bet_request'),
    hashtext(v_user_id::text || ':' || p_request_id::text)
  );

  select
    d.request_hash,
    d.response
  into
    v_existing_hash,
    v_existing_response
  from public.bet_request_dedup d
  where d.user_id = v_user_id
    and d.client_request_id = p_request_id
  limit 1;

  if v_existing_response is not null then
    if v_existing_hash <> v_request_hash then
      raise exception 'Idempotency key reused with different payload';
    end if;

    return v_existing_response;
  end if;

  select p.balance_vb
  into v_current_balance
  from public.profiles p
  where p.id = v_user_id
  for update;

  if v_current_balance is null then
    raise exception 'Profile not found';
  end if;

  if v_current_balance < v_stake then
    raise exception 'Insufficient balance';
  end if;

  with raw_items as (
    select
      case
        when coalesce(value->>'match_id_bigint', '') ~ '^\d+$'
          then (value->>'match_id_bigint')::bigint
        else null
      end as match_id,
      lower(trim(coalesce(value->>'market', ''))) as market,
      trim(coalesce(value->>'pick', '')) as pick,
      row_number() over () as row_no
    from jsonb_array_elements(p_items) as t(value)
  ),
  validated as (
    select
      r.row_no,
      r.match_id,
      r.market,
      r.pick,
      m.id as matched_match_id,
      coalesce(m.competition_name, m.competition_id, '') as league,
      m.home_team,
      m.away_team,
      m.utc_date as kickoff_at,
      m.status as match_status,
      coalesce(m.betting_closed, false) as betting_closed,
      (
        select o.book_odds::numeric
        from public.odds o
        where o.match_id = r.match_id
          and o.market_id = r.market
          and o.selection = r.pick
        order by o.updated_at desc nulls last
        limit 1
      ) as odds
    from raw_items r
    left join public.matches m
      on m.id = r.match_id
  )
  select
    count(*) as items_count,
    count(*) filter (
      where match_id is null
         or market = ''
         or pick = ''
    ) as invalid_items,
    count(*) filter (
      where matched_match_id is not null
    ) as matched_count,
    count(*) filter (
      where matched_match_id is not null
        and betting_closed = false
        and kickoff_at > now()
        and match_status in ('SCHEDULED', 'TIMED')
    ) as open_count,
    count(*) filter (
      where odds is not null
        and odds > 1
    ) as priced_count,
    count(
      distinct md5(
        coalesce(match_id::text, '') || '|' || market || '|' || pick
      )
    ) as distinct_items,
    round(exp(sum(ln(odds::float8)))::numeric, 2) as total_odds,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'match_id', match_id,
          'league', league,
          'home_team', home_team,
          'away_team', away_team,
          'market', market,
          'pick', pick,
          'odds', odds,
          'kickoff_at', kickoff_at
        )
        order by row_no
      ),
      '[]'::jsonb
    ) as validated_rows
  into
    v_items_count,
    v_invalid_items,
    v_matched_count,
    v_open_count,
    v_priced_count,
    v_distinct_items,
    v_total_odds,
    v_validated_rows
  from validated;

  if v_invalid_items > 0 then
    raise exception 'Invalid slip item';
  end if;

  if v_distinct_items <> v_items_count then
    raise exception 'Duplicate selections in slip';
  end if;

  if v_matched_count <> v_items_count then
    raise exception 'Match not found';
  end if;

  if v_open_count <> v_items_count then
    raise exception 'Match already started';
  end if;

  if v_priced_count <> v_items_count then
    raise exception 'Missing odds';
  end if;

  if v_total_odds is null then
    raise exception 'Missing odds';
  end if;

  v_potential_win := round(v_stake * v_total_odds, 2);

  insert into public.bets(
    user_id,
    stake,
    total_odds,
    potential_win,
    status,
    settled,
    payout
  )
  values (
    v_user_id,
    v_stake,
    v_total_odds,
    v_potential_win,
    'pending',
    false,
    0
  )
  returning id into v_bet_id;

  insert into public.bet_items(
    bet_id,
    user_id,
    match_id_bigint,
    league,
    home,
    away,
    market,
    pick,
    odds,
    kickoff_at,
    result,
    settled,
    settled_at
  )
  select
    v_bet_id,
    v_user_id,
    x.match_id,
    x.league,
    x.home_team,
    x.away_team,
    x.market,
    x.pick,
    x.odds,
    x.kickoff_at,
    null,
    false,
    null
  from jsonb_to_recordset(v_validated_rows) as x(
    match_id bigint,
    league text,
    home_team text,
    away_team text,
    market text,
    pick text,
    odds numeric,
    kickoff_at timestamptz
  );

  v_balance_after := public.vb_add_ledger(
    v_user_id,
    -v_stake,
    'BET_PLACED',
    'bet',
    v_bet_id::text
  );

  v_response := jsonb_build_object(
    'ok', true,
    'betId', v_bet_id,
    'stake', v_stake,
    'totalOdds', v_total_odds,
    'potentialWin', v_potential_win,
    'balanceAfter', v_balance_after
  );

  insert into public.bet_request_dedup(
    user_id,
    client_request_id,
    request_hash,
    bet_id,
    response
  )
  values (
    v_user_id,
    p_request_id,
    v_request_hash,
    v_bet_id,
    v_response
  )
  on conflict (user_id, client_request_id) do update
  set
    request_hash = excluded.request_hash,
    bet_id = excluded.bet_id,
    response = excluded.response;

  return v_response;
end;
$function$
;

-- ============================================================================
-- Function: public.run_system_check_suite(integer)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.run_system_check_suite(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_rows_count integer;
  v_sample jsonb;
  v_checks jsonb := '[]'::jsonb;
begin
  -- 1) profile balance vs latest ledger balance
  with last_ledger as (
    select distinct on (l.user_id)
      l.user_id,
      l.balance_after,
      l.created_at,
      l.id
    from public.vb_ledger l
    order by l.user_id, l.created_at desc, l.id desc
  ),
  mismatches as (
    select
      p.id as user_id,
      p.balance_vb as profile_balance,
      ll.balance_after as ledger_balance_after,
      round(coalesce(p.balance_vb, 0) - coalesce(ll.balance_after, 0), 2) as diff,
      ll.created_at as last_ledger_at
    from public.profiles p
    left join last_ledger ll
      on ll.user_id = p.id
    where round(coalesce(p.balance_vb, 0) - coalesce(ll.balance_after, 0), 2) <> 0
  )
  select
    (select count(*) from mismatches),
    coalesce(
      (
        select jsonb_agg(to_jsonb(x))
        from (
          select *
          from mismatches
          order by abs(diff) desc, last_ledger_at desc nulls last
          limit v_limit
        ) x
      ),
      '[]'::jsonb
    )
  into v_rows_count, v_sample;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'profile_balance_vs_latest_ledger',
      'severity', 'critical',
      'ok', v_rows_count = 0,
      'rowsCount', v_rows_count,
      'sample', v_sample
    )
  );

  -- 2) duplicate payout/refund ledger rows
  with dupes as (
    select
      l.ref_id as bet_id,
      l.kind,
      count(*) as rows_count,
      round(coalesce(sum(l.amount), 0), 2) as amount_sum,
      min(l.created_at) as first_at,
      max(l.created_at) as last_at
    from public.vb_ledger l
    where l.ref_type = 'bet'
      and l.kind in ('BET_PAYOUT', 'BET_REFUND')
    group by l.ref_id, l.kind
    having count(*) > 1
  )
  select
    (select count(*) from dupes),
    coalesce(
      (
        select jsonb_agg(to_jsonb(x))
        from (
          select *
          from dupes
          order by last_at desc, bet_id
          limit v_limit
        ) x
      ),
      '[]'::jsonb
    )
  into v_rows_count, v_sample;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'duplicate_payout_refund_ledger_rows',
      'severity', 'critical',
      'ok', v_rows_count = 0,
      'rowsCount', v_rows_count,
      'sample', v_sample
    )
  );

  -- 3) finished matches with unsettled bet items
  with rows_q as (
    select
      m.id as match_id,
      coalesce(m.competition_name, m.competition_id, '') as league,
      m.home_team,
      m.away_team,
      m.utc_date,
      count(*) filter (
        where coalesce(bi.settled, false) = false
           or bi.result is null
      ) as open_items
    from public.matches m
    join public.bet_items bi
      on bi.match_id_bigint = m.id
    where m.status = 'FINISHED'
    group by
      m.id,
      m.competition_name,
      m.competition_id,
      m.home_team,
      m.away_team,
      m.utc_date
    having count(*) filter (
      where coalesce(bi.settled, false) = false
         or bi.result is null
    ) > 0
  )
  select
    (select count(*) from rows_q),
    coalesce(
      (
        select jsonb_agg(to_jsonb(x))
        from (
          select *
          from rows_q
          order by utc_date desc, match_id desc
          limit v_limit
        ) x
      ),
      '[]'::jsonb
    )
  into v_rows_count, v_sample;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'finished_matches_with_unsettled_items',
      'severity', 'critical',
      'ok', v_rows_count = 0,
      'rowsCount', v_rows_count,
      'sample', v_sample
    )
  );

  -- 4) pending bets where all items are already resolved
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
  ),
  ready as (
    select
      b.id as bet_id,
      b.user_id,
      b.status,
      b.settled,
      b.created_at,
      i.items_total,
      i.items_resolved
    from public.bets b
    join item_status i
      on i.bet_id = b.id
    where b.settled = false
      and i.items_total > 0
      and i.items_total = i.items_resolved
  )
  select
    (select count(*) from ready),
    coalesce(
      (
        select jsonb_agg(to_jsonb(x))
        from (
          select *
          from ready
          order by created_at desc, bet_id
          limit v_limit
        ) x
      ),
      '[]'::jsonb
    )
  into v_rows_count, v_sample;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'pending_bets_fully_resolved_by_items',
      'severity', 'critical',
      'ok', v_rows_count = 0,
      'rowsCount', v_rows_count,
      'sample', v_sample
    )
  );

  -- 5) won bets missing payout row or with payout mismatch
  with rows_q as (
    select
      b.id as bet_id,
      b.user_id,
      round(coalesce(b.payout, 0), 2) as bet_payout,
      b.settled_at,
      count(l.id) as payout_rows,
      round(coalesce(sum(l.amount), 0), 2) as payout_sum
    from public.bets b
    left join public.vb_ledger l
      on l.ref_type = 'bet'
     and l.ref_id = b.id::text
     and l.kind = 'BET_PAYOUT'
    where b.settled = true
      and lower(coalesce(b.status, '')) = 'won'
    group by b.id, b.user_id, b.payout, b.settled_at
    having count(l.id) <> 1
       or round(coalesce(sum(l.amount), 0), 2) <> round(coalesce(b.payout, 0), 2)
  )
  select
    (select count(*) from rows_q),
    coalesce(
      (
        select jsonb_agg(to_jsonb(x))
        from (
          select *
          from rows_q
          order by settled_at desc nulls last, bet_id
          limit v_limit
        ) x
      ),
      '[]'::jsonb
    )
  into v_rows_count, v_sample;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'won_bets_missing_or_mismatched_payout',
      'severity', 'critical',
      'ok', v_rows_count = 0,
      'rowsCount', v_rows_count,
      'sample', v_sample
    )
  );

  -- 6) void bets missing refund row or with refund mismatch
  with rows_q as (
    select
      b.id as bet_id,
      b.user_id,
      round(coalesce(b.payout, 0), 2) as bet_payout,
      b.settled_at,
      count(l.id) as refund_rows,
      round(coalesce(sum(l.amount), 0), 2) as refund_sum
    from public.bets b
    left join public.vb_ledger l
      on l.ref_type = 'bet'
     and l.ref_id = b.id::text
     and l.kind = 'BET_REFUND'
    where b.settled = true
      and lower(coalesce(b.status, '')) = 'void'
    group by b.id, b.user_id, b.payout, b.settled_at
    having count(l.id) <> 1
       or round(coalesce(sum(l.amount), 0), 2) <> round(coalesce(b.payout, 0), 2)
  )
  select
    (select count(*) from rows_q),
    coalesce(
      (
        select jsonb_agg(to_jsonb(x))
        from (
          select *
          from rows_q
          order by settled_at desc nulls last, bet_id
          limit v_limit
        ) x
      ),
      '[]'::jsonb
    )
  into v_rows_count, v_sample;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'void_bets_missing_or_mismatched_refund',
      'severity', 'critical',
      'ok', v_rows_count = 0,
      'rowsCount', v_rows_count,
      'sample', v_sample
    )
  );

  -- 7) lost bets that still have payout/refund rows
  with rows_q as (
    select
      b.id as bet_id,
      b.user_id,
      b.settled_at,
      count(l.id) as ledger_rows,
      round(coalesce(sum(l.amount), 0), 2) as ledger_sum
    from public.bets b
    join public.vb_ledger l
      on l.ref_type = 'bet'
     and l.ref_id = b.id::text
     and l.kind in ('BET_PAYOUT', 'BET_REFUND')
    where b.settled = true
      and lower(coalesce(b.status, '')) = 'lost'
    group by b.id, b.user_id, b.settled_at
  )
  select
    (select count(*) from rows_q),
    coalesce(
      (
        select jsonb_agg(to_jsonb(x))
        from (
          select *
          from rows_q
          order by settled_at desc nulls last, bet_id
          limit v_limit
        ) x
      ),
      '[]'::jsonb
    )
  into v_rows_count, v_sample;

  v_checks := v_checks || jsonb_build_array(
    jsonb_build_object(
      'checkKey', 'lost_bets_with_payout_or_refund_rows',
      'severity', 'critical',
      'ok', v_rows_count = 0,
      'rowsCount', v_rows_count,
      'sample', v_sample
    )
  );

  return jsonb_build_object(
    'ok',
      not exists (
        select 1
        from jsonb_array_elements(v_checks) as e
        where coalesce((e->>'ok')::boolean, false) = false
      ),
    'checksTotal', jsonb_array_length(v_checks),
    'checksPassed',
      (
        select count(*)
        from jsonb_array_elements(v_checks) as e
        where coalesce((e->>'ok')::boolean, false) = true
      ),
    'checksFailed',
      (
        select count(*)
        from jsonb_array_elements(v_checks) as e
        where coalesce((e->>'ok')::boolean, false) = false
      ),
    'checks', v_checks
  );
end;
$function$
;

-- ============================================================================
-- Function: public.settle_bet(uuid)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_bet(p_bet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_stake numeric;
  v_items_total int;
  v_all_resolved boolean;
  v_has_lost boolean;
  v_nonvoid_count int;
  v_logsum float8;
  v_effective_odds numeric;
  v_payout numeric;
  v_ref_id text;
  v_has_existing_payout boolean;
  v_has_existing_refund boolean;
begin
  select user_id, stake
    into v_user_id, v_stake
  from public.bets
  where id = p_bet_id
  for update;

  if v_user_id is null then
    raise exception 'Bet not found: %', p_bet_id;
  end if;

  if exists (
    select 1
    from public.bets b
    where b.id = p_bet_id
      and b.settled = true
  ) then
    return;
  end if;

  select
    count(*) as items_total,
    bool_and(
      coalesce(settled, false) = true
      and lower(coalesce(result, '')) in ('won', 'lost', 'void')
    ) as all_resolved,
    bool_or(lower(coalesce(result, '')) = 'lost') as has_lost,
    count(*) filter (where lower(coalesce(result, '')) <> 'void') as nonvoid_count
  into
    v_items_total,
    v_all_resolved,
    v_has_lost,
    v_nonvoid_count
  from public.bet_items
  where bet_id = p_bet_id;

  if coalesce(v_items_total, 0) = 0 then
    return;
  end if;

  v_ref_id := p_bet_id::text;

  select exists (
    select 1
    from public.vb_ledger l
    where l.ref_type = 'bet'
      and l.ref_id = v_ref_id
      and l.kind = 'BET_PAYOUT'
  )
  into v_has_existing_payout;

  select exists (
    select 1
    from public.vb_ledger l
    where l.ref_type = 'bet'
      and l.ref_id = v_ref_id
      and l.kind = 'BET_REFUND'
  )
  into v_has_existing_refund;

  -- AKO przegrywa natychmiast po pierwszym przegranym zdarzeniu.
  if coalesce(v_has_lost, false) then
    if v_has_existing_payout or v_has_existing_refund then
      raise exception 'Ledger inconsistency for lost bet %: payout/refund row already exists', p_bet_id;
    end if;

    update public.bets
    set
      status = 'lost',
      settled = true,
      settled_at = now(),
      payout = 0
    where id = p_bet_id;

    return;
  end if;

  -- Jeśli nic nie przegrało, czekamy aż wszystkie zdarzenia będą rozliczone.
  if v_all_resolved is distinct from true then
    return;
  end if;

  select coalesce(sum(ln(greatest(odds, 0.0000001)::float8)), 0.0)
    into v_logsum
  from public.bet_items
  where bet_id = p_bet_id
    and lower(coalesce(result, '')) <> 'void';

  v_effective_odds := exp(v_logsum);

  if coalesce(v_nonvoid_count, 0) = 0 then
    if v_has_existing_payout then
      raise exception 'Ledger inconsistency for void bet %: payout row already exists', p_bet_id;
    end if;

    if v_has_existing_refund then
      raise exception 'Refund already exists for bet %', p_bet_id;
    end if;

    v_payout := round(v_stake, 2);

    update public.bets
    set
      status = 'void',
      settled = true,
      settled_at = now(),
      payout = v_payout
    where id = p_bet_id;

    perform public.apply_vb_transaction(
      v_user_id,
      v_payout,
      'BET_REFUND',
      'bet',
      v_ref_id
    );

    return;
  end if;

  if v_has_existing_refund then
    raise exception 'Ledger inconsistency for won bet %: refund row already exists', p_bet_id;
  end if;

  if v_has_existing_payout then
    raise exception 'Payout already exists for bet %', p_bet_id;
  end if;

  v_payout := round((v_stake * v_effective_odds)::numeric, 2);

  update public.bets
  set
    status = 'won',
    settled = true,
    settled_at = now(),
    payout = v_payout
  where id = p_bet_id;

  perform public.apply_vb_transaction(
    v_user_id,
    v_payout,
    'BET_PAYOUT',
    'bet',
    v_ref_id
  );
end;
$function$
;

-- ============================================================================
-- Function: public.settle_match(bigint)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_match(p_match_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_home_score int;
  v_away_score int;
  v_ht_home_score int;
  v_ht_away_score int;
  v_sh_home_score int;
  v_sh_away_score int;
  v_bet_id uuid;
begin
  select
    mr.status,
    mr.home_score,
    mr.away_score,
    mr.ht_home_score,
    mr.ht_away_score,
    mr.sh_home_score,
    mr.sh_away_score
  into
    v_status,
    v_home_score,
    v_away_score,
    v_ht_home_score,
    v_ht_away_score,
    v_sh_home_score,
    v_sh_away_score
  from public.match_results mr
  where mr.match_id = p_match_id;

  if not found then
    raise exception 'match_results not found for match_id=%', p_match_id;
  end if;

  with resolved as (
    select
      bi.id,
      public.resolve_market_result(
        bi.market,
        bi.pick,
        v_status,
        v_home_score,
        v_away_score,
        v_ht_home_score,
        v_ht_away_score,
        v_sh_home_score,
        v_sh_away_score
      ) as new_result
    from public.bet_items bi
    where bi.match_id_bigint = p_match_id
      and (
        coalesce(bi.settled, false) = false
        or bi.result is null
      )
  )
  update public.bet_items bi
  set
    result = r.new_result,
    settled = case
      when r.new_result in ('won', 'lost', 'void') then true
      else false
    end,
    settled_at = case
      when r.new_result in ('won', 'lost', 'void') then now()
      else bi.settled_at
    end
  from resolved r
  where bi.id = r.id;

  -- Po rozliczeniu zdarzeń przeliczamy wszystkie kupony,
  -- które zawierały ten mecz.
  for v_bet_id in
    select distinct bi.bet_id
    from public.bet_items bi
    where bi.match_id_bigint = p_match_id
  loop
    perform public.settle_bet(v_bet_id);
  end loop;
end;
$function$
;

-- ============================================================================
-- Function: public.settle_match_once(bigint)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_match_once(p_match_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$--settle_match_once
declare
  v_existing_status text;
  v_open_before int := 0;
  v_open_after  int := 0;
begin
  -- 1) anty-race: tylko jedna transakcja na match_id
  if not pg_try_advisory_xact_lock(p_match_id) then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already_settling',
      'matchId', p_match_id,
      'skipped', true
    );
  end if;

  -- 2) policz otwarte pozycje (przed)
  select count(*) into v_open_before
  from public.bet_items
  where match_id_bigint = p_match_id
    and (settled = false or result is null);

  -- 3) upewnij sie, ze istnieje wiersz w match_settlements
  insert into public.match_settlements (match_id, status, started_at)
  values (p_match_id, 'pending', now())
  on conflict (match_id) do nothing;

  -- 4) zablokuj wiersz settlement i pobierz status
  select ms.status
    into v_existing_status
  from public.match_settlements ms
  where ms.match_id = p_match_id
  for update;

  -- 5) jeśli już done i nic otwarte -> skip
  if v_existing_status = 'done' and v_open_before = 0 then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already_done',
      'matchId', p_match_id,
      'skipped', true,
      'openBefore', v_open_before,
      'openAfter', v_open_before
    );
  end if;

  -- 6) oznacz jako running (również w trybie "repair po done")
  update public.match_settlements
  set status = 'running',
      started_at = now(),
      finished_at = null,
      error = null
  where match_id = p_match_id;

  begin
    perform public.settle_match(p_match_id);

    -- policz otwarte po (ważne!)
    select count(*) into v_open_after
    from public.bet_items
    where match_id_bigint = p_match_id
      and (settled = false or result is null);

    if v_open_after = 0 then
      update public.match_settlements
      set status = 'done',
          finished_at = now(),
          error = null
      where match_id = p_match_id;

      return jsonb_build_object(
        'ok', true,
        'reason', 'done',
        'matchId', p_match_id,
        'skipped', false,
        'openBefore', v_open_before,
        'openAfter', v_open_after
      );
    else
      update public.match_settlements
      set status = 'failed',
          finished_at = now(),
          error = 'still_open_items_after_settle=' || v_open_after
      where match_id = p_match_id;

      return jsonb_build_object(
        'ok', false,
        'reason', 'failed_open_items_remain',
        'matchId', p_match_id,
        'skipped', false,
        'openBefore', v_open_before,
        'openAfter', v_open_after
      );
    end if;

  exception when others then
    update public.match_settlements
    set status = 'failed',
        finished_at = now(),
        error = sqlerrm
    where match_id = p_match_id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'failed_exception',
      'matchId', p_match_id,
      'skipped', false,
      'error', sqlerrm
    );
  end;
end;$function$
;

-- ============================================================================
-- Function: public.upsert_match_result(text, text, integer, integer, integer, integer, timestamp with time zone, timestamp with time zone)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_match_result(p_match_id text, p_status text, p_home_score integer, p_away_score integer, p_ht_home integer DEFAULT NULL::integer, p_ht_away integer DEFAULT NULL::integer, p_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_finished_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_sh_home int;
  v_sh_away int;
begin
  if p_ht_home is not null and p_ht_away is not null
     and p_home_score is not null and p_away_score is not null then
    v_sh_home := p_home_score - p_ht_home;
    v_sh_away := p_away_score - p_ht_away;
  else
    v_sh_home := null;
    v_sh_away := null;
  end if;

  insert into public.match_results(
    match_id, status,
    home_score, away_score,
    ht_home_score, ht_away_score,
    sh_home_score, sh_away_score,
    started_at, finished_at, updated_at
  )
  values (
    p_match_id, p_status,
    p_home_score, p_away_score,
    p_ht_home, p_ht_away,
    v_sh_home, v_sh_away,
    p_started_at, p_finished_at, now()
  )
  on conflict (match_id) do update set
    status = excluded.status,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    ht_home_score = excluded.ht_home_score,
    ht_away_score = excluded.ht_away_score,
    sh_home_score = excluded.sh_home_score,
    sh_away_score = excluded.sh_away_score,
    started_at = coalesce(excluded.started_at, public.match_results.started_at),
    finished_at = coalesce(excluded.finished_at, public.match_results.finished_at),
    updated_at = now();
end;
$function$
;

-- ============================================================================
-- Function: public.upsert_match_result(text, text, integer, integer, timestamp with time zone, timestamp with time zone)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_match_result(p_match_id text, p_status text, p_home_score integer, p_away_score integer, p_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_finished_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.match_results(match_id, status, home_score, away_score, started_at, finished_at, updated_at)
  values (p_match_id, p_status, p_home_score, p_away_score, p_started_at, p_finished_at, now())
  on conflict (match_id) do update set
    status = excluded.status,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    started_at = coalesce(excluded.started_at, public.match_results.started_at),
    finished_at = coalesce(excluded.finished_at, public.match_results.finished_at),
    updated_at = now();
end;
$function$
;

-- ============================================================================
-- Function: public.vb_weekly_grant()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.vb_weekly_grant()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_grant_amount numeric := 200;
  v_week_id text := to_char((now() at time zone 'utc')::date, 'IYYY-"W"IW');
  v_ref_id text := 'weekly_' || v_week_id;
  r record;
begin
  for r in
    select id
    from public.profiles
  loop
    perform public.apply_vb_transaction(
      r.id,
      v_grant_amount,
      'WEEKLY_GRANT',
      'weekly',
      v_ref_id
    );
  end loop;
end;
$function$
;

-- ============================================================================
-- Function: public.vb_weekly_grant_if_due(uuid)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.vb_weekly_grant_if_due(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_grant_amount numeric := 200;
  v_now timestamptz := now();
  v_monday_noon_utc timestamptz;
  v_week_start_utc timestamptz;
  v_next_week_start_utc timestamptz;
  v_week_id text;
  v_ref_id text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  v_week_start_utc :=
    date_trunc('week', v_now at time zone 'utc') at time zone 'utc';
  v_next_week_start_utc := v_week_start_utc + interval '7 days';
  v_monday_noon_utc := v_week_start_utc + interval '12 hours';

  if v_now < v_monday_noon_utc then
    return false;
  end if;

  v_week_id := to_char((v_now at time zone 'utc')::date, 'IYYY-"W"IW');
  v_ref_id := 'weekly_' || v_week_id;

  perform pg_advisory_xact_lock(
    hashtext('vb_weekly_grant'),
    hashtext(p_user_id::text || ':' || v_ref_id)
  );

  -- Legacy-safe idempotency: if any WEEKLY_GRANT already exists for this
  -- user in the current UTC ISO week, do not grant again, even if an older
  -- ref_type/ref_id scheme was used.
  if exists (
    select 1
    from public.vb_ledger
    where user_id = p_user_id
      and kind = 'WEEKLY_GRANT'
      and created_at >= v_week_start_utc
      and created_at < v_next_week_start_utc
  ) then
    return false;
  end if;

  perform public.apply_vb_transaction(
    p_user_id,
    v_grant_amount,
    'WEEKLY_GRANT',
    'weekly',
    v_ref_id
  );

  return true;
end;
$function$
;

