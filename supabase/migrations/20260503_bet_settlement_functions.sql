functions_found,migration_sql
4,"-- =====================================================================
-- Function: vb_add_ledger(uuid,numeric,text,text,text)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.vb_add_ledger(p_user_id uuid, p_amount numeric, p_kind text, p_ref_type text, p_ref_id text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$--vb_add_ledger
declare
  v_current_balance numeric;
  v_new_balance numeric;
  v_ledger_id uuid;
  v_rows int;
begin
  -- ✅ SECURITY: zwykły user może księgować TYLKO sobie
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    if p_user_id <> auth.uid() then
      raise exception 'Not authorized';
    end if;
  end if;

  -- blokujemy profil
  select balance_vb
    into v_current_balance
  from public.profiles
  where id = p_user_id
  for update;

  if v_current_balance is null then
    raise exception 'Profile not found';
  end if;

  v_new_balance := round(v_current_balance + p_amount, 2);

  if v_new_balance < 0 then
    raise exception 'Insufficient balance';
  end if;

  v_ledger_id := gen_random_uuid();

  insert into public.vb_ledger(
    id, user_id, amount, balance_after, kind, ref_type, ref_id, created_at
  )
  values (
    v_ledger_id, p_user_id, round(p_amount,2), v_new_balance, p_kind, p_ref_type, p_ref_id, now()
  )
  on conflict (user_id, ref_type, ref_id, kind) do nothing;

  get diagnostics v_rows = row_count;

  -- jeśli duplikat (idempotencja) -> nie ruszamy profilu, zwracamy aktualne saldo
  if v_rows = 0 then
    return v_current_balance;
  end if;

  update public.profiles
  set
    balance_vb = v_new_balance,
    last_ledger_id = v_ledger_id,
    last_tx_amount = p_amount,
    last_tx_at = now()
  where id = p_user_id;

  return v_new_balance;
end;$function$


revoke all on function vb_add_ledger(uuid,numeric,text,text,text) from public;
revoke all on function vb_add_ledger(uuid,numeric,text,text,text) from anon;
revoke all on function vb_add_ledger(uuid,numeric,text,text,text) from authenticated;
grant execute on function vb_add_ledger(uuid,numeric,text,text,text) to service_role;


-- =====================================================================
-- Function: settle_bet(uuid)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.settle_bet(p_bet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$


revoke all on function settle_bet(uuid) from public;
revoke all on function settle_bet(uuid) from anon;
revoke all on function settle_bet(uuid) from authenticated;
grant execute on function settle_bet(uuid) to service_role;


-- =====================================================================
-- Function: settle_match_once(bigint)
-- =====================================================================

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

  -- 6) oznacz jako running (również w trybie ""repair po done"")
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


revoke all on function settle_match_once(bigint) from public;
revoke all on function settle_match_once(bigint) from anon;
revoke all on function settle_match_once(bigint) from authenticated;
grant execute on function settle_match_once(bigint) to service_role;


-- =====================================================================
-- Function: settle_match(bigint)
-- =====================================================================

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


revoke all on function settle_match(bigint) from public;
revoke all on function settle_match(bigint) from anon;
revoke all on function settle_match(bigint) from authenticated;
grant execute on function settle_match(bigint) to service_role;


select pg_notify('pgrst', 'reload schema');
"