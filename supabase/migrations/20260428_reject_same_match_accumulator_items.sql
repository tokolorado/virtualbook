-- Reject correlated selections in standard accumulator slips.
-- A standard accumulator multiplies independent events. Several selections
-- from one match require a separate same-game-parlay / Bet Builder pricing
-- engine, so place_bet rejects them at the database boundary.

begin;

create or replace function public.place_bet(
  p_stake numeric,
  p_items jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  v_distinct_matches integer := 0;

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
    count(distinct match_id) filter (
      where match_id is not null
    ) as distinct_matches,
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
    v_distinct_matches,
    v_total_odds,
    v_validated_rows
  from validated;

  if v_invalid_items > 0 then
    raise exception 'Invalid slip item';
  end if;

  if v_distinct_items <> v_items_count then
    raise exception 'Duplicate selections in slip';
  end if;

  if v_distinct_matches <> v_items_count then
    raise exception 'Correlated selections in same match are not allowed';
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
$function$;

revoke all on function public.place_bet(numeric, jsonb, uuid)
from public, anon;

grant execute on function public.place_bet(numeric, jsonb, uuid)
to authenticated, service_role;

commit;
