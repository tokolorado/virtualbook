-- Harden SECURITY DEFINER result upsert overloads.
-- The production definitions exported on 2026-04-27 showed both overloads
-- without a pinned search_path. Keep the bodies unchanged and only pin name
-- resolution to public.

begin;

alter function public.upsert_match_result(
  text,
  text,
  integer,
  integer,
  integer,
  integer,
  timestamp with time zone,
  timestamp with time zone
) set search_path to public;

alter function public.upsert_match_result(
  text,
  text,
  integer,
  integer,
  timestamp with time zone,
  timestamp with time zone
) set search_path to public;

commit;
