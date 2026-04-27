-- Restrict direct EXECUTE permissions for wallet, settlement, result upsert,
-- system-check, and weekly-grant functions.
--
-- Keep place_bet callable by authenticated users; it relies on auth.uid().
-- All other mutation/repair/settlement functions should be reached only through
-- server-side API routes using the service role key.

begin;

revoke all on function public.apply_vb_transaction(
  uuid,
  numeric,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.apply_vb_transaction(
  uuid,
  numeric,
  text,
  text,
  text
) to service_role;

revoke all on function public.place_bet(
  numeric,
  jsonb,
  uuid
) from public, anon;
grant execute on function public.place_bet(
  numeric,
  jsonb,
  uuid
) to authenticated, service_role;

revoke all on function public.run_system_check_suite(integer)
from public, anon, authenticated;
grant execute on function public.run_system_check_suite(integer)
to service_role;

revoke all on function public.settle_bet(uuid)
from public, anon, authenticated;
grant execute on function public.settle_bet(uuid)
to service_role;

revoke all on function public.settle_match(bigint)
from public, anon, authenticated;
grant execute on function public.settle_match(bigint)
to service_role;

revoke all on function public.settle_match_once(bigint)
from public, anon, authenticated;
grant execute on function public.settle_match_once(bigint)
to service_role;

revoke all on function public.upsert_match_result(
  text,
  text,
  integer,
  integer,
  integer,
  integer,
  timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated;
grant execute on function public.upsert_match_result(
  text,
  text,
  integer,
  integer,
  integer,
  integer,
  timestamp with time zone,
  timestamp with time zone
) to service_role;

revoke all on function public.upsert_match_result(
  text,
  text,
  integer,
  integer,
  timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated;
grant execute on function public.upsert_match_result(
  text,
  text,
  integer,
  integer,
  timestamp with time zone,
  timestamp with time zone
) to service_role;

revoke all on function public.vb_weekly_grant_if_due(uuid)
from public, anon, authenticated;
grant execute on function public.vb_weekly_grant_if_due(uuid)
to service_role;

revoke all on function public.grant_weekly_vb(numeric)
from public, anon, authenticated;
grant execute on function public.grant_weekly_vb(numeric)
to service_role;

revoke all on function public.vb_weekly_grant()
from public, anon, authenticated;
grant execute on function public.vb_weekly_grant()
to service_role;

commit;
