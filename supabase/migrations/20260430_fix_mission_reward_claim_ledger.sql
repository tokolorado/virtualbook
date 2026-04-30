-- Keep mission reward claims service-role safe and independent from auth.uid().
--
-- The API already verifies the user session before calling this RPC with the
-- target user id. The ledger write must therefore use the explicit p_user_id
-- and not any helper that depends on SQL auth context.

begin;

create or replace function public.claim_mission_reward(
  p_user_id uuid,
  p_mission_id text,
  p_period_key text,
  p_reward_amount numeric,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_reward numeric(12,2);
  v_claim_id uuid;
  v_balance_after numeric(12,2);
  v_ref_id text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if nullif(trim(coalesce(p_mission_id, '')), '') is null then
    raise exception 'p_mission_id is required';
  end if;

  if nullif(trim(coalesce(p_period_key, '')), '') is null then
    raise exception 'p_period_key is required';
  end if;

  if p_reward_amount is null or p_reward_amount <= 0 then
    raise exception 'Invalid reward amount';
  end if;

  v_reward := round(p_reward_amount, 2);
  v_ref_id := p_mission_id || ':' || p_period_key;

  perform pg_advisory_xact_lock(
    hashtext('claim_mission_reward'),
    hashtext(p_user_id::text || ':' || v_ref_id)
  );

  insert into public.user_mission_claims (
    user_id,
    mission_id,
    period_key,
    reward_amount,
    details
  )
  values (
    p_user_id,
    p_mission_id,
    p_period_key,
    v_reward,
    coalesce(p_details, '{}'::jsonb)
  )
  on conflict (user_id, mission_id, period_key) do nothing
  returning id into v_claim_id;

  if v_claim_id is null then
    select balance_vb
      into v_balance_after
    from public.profiles
    where id = p_user_id;

    return jsonb_build_object(
      'ok', true,
      'claimed', false,
      'reason', 'already_claimed',
      'missionId', p_mission_id,
      'periodKey', p_period_key,
      'balanceAfter', v_balance_after
    );
  end if;

  perform public.apply_vb_transaction(
    p_user_id,
    v_reward,
    'MISSION_REWARD',
    'mission',
    v_ref_id
  );

  select balance_vb
    into v_balance_after
  from public.profiles
  where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'missionId', p_mission_id,
    'periodKey', p_period_key,
    'rewardAmount', v_reward,
    'balanceAfter', v_balance_after
  );
end;
$function$;

revoke all on function public.claim_mission_reward(uuid, text, text, numeric, jsonb)
from public, anon, authenticated;

grant execute on function public.claim_mission_reward(uuid, text, text, numeric, jsonb)
to service_role;

commit;
