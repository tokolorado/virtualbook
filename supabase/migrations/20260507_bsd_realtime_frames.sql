begin;

create table if not exists public.bsd_realtime_frames (
  id bigserial primary key,
  frame_type text,
  source_event_id text,
  match_id bigint references public.matches(id) on delete set null,
  payload jsonb not null,
  processed_status text not null default 'raw_captured',
  error text,
  received_at timestamptz not null default now()
);

create index if not exists bsd_realtime_frames_event_idx
  on public.bsd_realtime_frames (source_event_id, received_at desc);

create index if not exists bsd_realtime_frames_match_idx
  on public.bsd_realtime_frames (match_id, received_at desc);

create index if not exists bsd_realtime_frames_type_idx
  on public.bsd_realtime_frames (frame_type, received_at desc);

commit;
