-- Weekly grant amount change: 1000 VB -> 200 VB.
-- Keep existing RPC behavior: boolean return, Monday 12:00 UTC gate,
-- advisory transaction lock, and ledger-based idempotency.

drop function if exists public.vb_weekly_grant_if_due(uuid);

create or replace function public.vb_weekly_grant_if_due(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

revoke all on function public.vb_weekly_grant_if_due(uuid) from public;
grant execute on function public.vb_weekly_grant_if_due(uuid) to authenticated;
grant execute on function public.vb_weekly_grant_if_due(uuid) to service_role;

-- Legacy entry points found in older database exports. Keep them on 200 VB as
-- well, so no remaining weekly-grant path can still issue 1000 VB.
create or replace function public.grant_weekly_vb(p_amount numeric default 200)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

revoke all on function public.grant_weekly_vb(numeric) from public;
revoke all on function public.grant_weekly_vb(numeric) from anon;
revoke all on function public.grant_weekly_vb(numeric) from authenticated;
grant execute on function public.grant_weekly_vb(numeric) to service_role;

create or replace function public.vb_weekly_grant()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

revoke all on function public.vb_weekly_grant() from public;
revoke all on function public.vb_weekly_grant() from anon;
revoke all on function public.vb_weekly_grant() from authenticated;
grant execute on function public.vb_weekly_grant() to service_role;
