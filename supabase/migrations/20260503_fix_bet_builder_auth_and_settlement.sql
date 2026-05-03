begin;

create or replace function public.place_bet_builder(
  p_user_id uuid,
  p_stake numeric,
  p_items jsonb,
  p_request_id uuid,
  p_total_odds numeric,
  p_pricing_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := p_user_id;

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
  v_distinct_matches integer := 0;

  v_current_balance numeric(12,2);
  v_validated_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if v_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if v_user_id <> auth.uid() then
    raise exception 'User mismatch';
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

  if p_total_odds is null or p_total_odds <= 1 or p_total_odds > 150 then
    raise exception 'Invalid Bet Builder total odds';
  end if;

  v_total_odds := round(p_total_odds, 2);

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 2 then
    raise exception 'Bet Builder requires at least two items';
  end if;

  if jsonb_array_length(p_items) > 8 then
    raise exception 'Too many Bet Builder items';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and coalesce(p.is_banned, false) = true
  ) then
    raise exception 'User is banned';
  end if;

  v_request_hash :=
    public.make_bet_request_hash(v_stake, p_items)
    || ':bet_builder:'
    || md5(v_total_odds::text || ':' || coalesce(p_pricing_meta, '{}'::jsonb)::text);

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
          and o.source = 'bsd'
        order by o.updated_at desc nulls last
        limit 1
      ) as odds
    from raw_items r
    left join public.matches m
      on m.id = r.match_id
  )
  select
    count(*),
    count(*) filter (
      where match_id is null
         or market = ''
         or pick = ''
    ),
    count(*) filter (
      where matched_match_id is not null
    ),
    count(*) filter (
      where matched_match_id is not null
        and betting_closed = false
        and kickoff_at > now()
        and match_status in ('SCHEDULED', 'TIMED')
    ),
    count(*) filter (
      where odds is not null
        and odds > 1
    ),
    count(
      distinct md5(
        coalesce(match_id::text, '') || '|' || market || '|' || pick
      )
    ),
    count(distinct match_id) filter (
      where match_id is not null
    ),
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
    )
  into
    v_items_count,
    v_invalid_items,
    v_matched_count,
    v_open_count,
    v_priced_count,
    v_distinct_items,
    v_distinct_matches,
    v_validated_rows
  from validated;

  if v_invalid_items > 0 then
    raise exception 'Invalid slip item';
  end if;

  if v_distinct_items <> v_items_count then
    raise exception 'Duplicate selections in Bet Builder';
  end if;

  if v_distinct_matches <> 1 then
    raise exception 'Bet Builder requires exactly one match';
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

  v_potential_win := round(v_stake * v_total_odds, 2);

  insert into public.bets(
    user_id,
    stake,
    total_odds,
    potential_win,
    status,
    settled,
    payout,
    bet_type,
    pricing_meta
  )
  values (
    v_user_id,
    v_stake,
    v_total_odds,
    v_potential_win,
    'pending',
    false,
    0,
    'bet_builder',
    coalesce(p_pricing_meta, '{}'::jsonb)
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
    'mode', 'bet_builder',
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
$function$;

create or replace function public.settle_bet(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid;
  v_stake numeric;
  v_stored_total_odds numeric;
  v_bet_type text;
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
  select
    user_id,
    stake,
    total_odds,
    coalesce(bet_type, 'standard')
  into
    v_user_id,
    v_stake,
    v_stored_total_odds,
    v_bet_type
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

  if v_all_resolved is distinct from true then
    return;
  end if;

  if v_bet_type = 'bet_builder' and coalesce(v_nonvoid_count, 0) <> v_items_total then
    if v_has_existing_payout then
      raise exception 'Ledger inconsistency for void bet builder %: payout row already exists', p_bet_id;
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

  if v_bet_type = 'bet_builder' then
    v_effective_odds := v_stored_total_odds;
  else
    select coalesce(sum(ln(greatest(odds, 0.0000001)::float8)), 0.0)
      into v_logsum
    from public.bet_items
    where bet_id = p_bet_id
      and lower(coalesce(result, '')) <> 'void';

    v_effective_odds := exp(v_logsum);
  end if;

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
$function$;

revoke execute on function public.place_bet_builder(
  uuid,
  numeric,
  jsonb,
  uuid,
  numeric,
  jsonb
) from public;

revoke execute on function public.place_bet_builder(
  uuid,
  numeric,
  jsonb,
  uuid,
  numeric,
  jsonb
) from anon;

grant usage on schema public to authenticated;

grant execute on function public.place_bet_builder(
  uuid,
  numeric,
  jsonb,
  uuid,
  numeric,
  jsonb
) to authenticated;

revoke execute on function public.settle_bet(uuid) from public;
revoke execute on function public.settle_bet(uuid) from anon;
revoke execute on function public.settle_bet(uuid) from authenticated;

grant execute on function public.settle_bet(uuid) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;