-- Admin-only manual settlement helper.
--
-- This keeps manual settlement transactional: item override, bet settlement,
-- ledger payout/refund, and audit log happen in one database transaction.
-- The function is executable only through service-role backend routes.

begin;

create or replace function public.admin_force_settle_bet(
  p_bet_id uuid,
  p_status text,
  p_admin_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_bet public.bets%rowtype;
  v_after public.bets%rowtype;
  v_items_total integer := 0;
  v_items_updated integer := 0;
  v_previous_breakdown jsonb := '{}'::jsonb;
begin
  if p_bet_id is null then
    raise exception 'p_bet_id is required';
  end if;

  if v_status not in ('won', 'lost', 'void') then
    raise exception 'Invalid manual settlement status: %', p_status;
  end if;

  select *
    into v_bet
  from public.bets
  where id = p_bet_id
  for update;

  if not found then
    raise exception 'Bet not found: %', p_bet_id;
  end if;

  select
    count(*)::integer,
    coalesce(
      jsonb_object_agg(coalesce(result_key, 'null'), item_count),
      '{}'::jsonb
    )
  into
    v_items_total,
    v_previous_breakdown
  from (
    select
      lower(coalesce(result, 'null')) as result_key,
      count(*) as item_count
    from public.bet_items
    where bet_id = p_bet_id
    group by lower(coalesce(result, 'null'))
  ) s;

  if v_items_total = 0 then
    raise exception 'Bet has no items: %', p_bet_id;
  end if;

  if coalesce(v_bet.settled, false) = true then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_settled',
      'betId', p_bet_id,
      'status', v_bet.status,
      'payout', v_bet.payout,
      'previousBreakdown', v_previous_breakdown
    );
  end if;

  update public.bet_items
  set
    result = v_status,
    settled = true,
    settled_at = now()
  where bet_id = p_bet_id
    and (
      coalesce(settled, false) = false
      or lower(coalesce(result, '')) <> v_status
    );

  get diagnostics v_items_updated = row_count;

  perform public.settle_bet(p_bet_id);

  select *
    into v_after
  from public.bets
  where id = p_bet_id;

  if p_admin_user_id is not null then
    insert into public.admin_audit_logs (
      admin_user_id,
      action,
      target_user_id,
      details
    )
    values (
      p_admin_user_id,
      'admin_force_settle_bet',
      v_after.user_id,
      jsonb_build_object(
        'betId', p_bet_id,
        'forcedStatus', v_status,
        'previousBetStatus', v_bet.status,
        'previousSettled', v_bet.settled,
        'previousPayout', v_bet.payout,
        'previousBreakdown', v_previous_breakdown,
        'itemsTotal', v_items_total,
        'itemsUpdated', v_items_updated,
        'finalBetStatus', v_after.status,
        'finalSettled', v_after.settled,
        'finalPayout', v_after.payout
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'betId', p_bet_id,
    'forcedStatus', v_status,
    'itemsTotal', v_items_total,
    'itemsUpdated', v_items_updated,
    'previousBreakdown', v_previous_breakdown,
    'status', v_after.status,
    'settled', v_after.settled,
    'payout', v_after.payout
  );
end;
$function$;

revoke all on function public.admin_force_settle_bet(uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.admin_force_settle_bet(uuid, text, uuid)
to service_role;

commit;
