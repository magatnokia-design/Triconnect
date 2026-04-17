-- Run this in Supabase SQL editor to enable meeting persistence.

create table if not exists public.meeting_sessions (
  id uuid primary key default gen_random_uuid(),
  meeting_key text not null,
  class_id uuid not null references public.classes(id) on delete cascade,
  host_user_id uuid,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_sessions_class_id on public.meeting_sessions(class_id);
create index if not exists idx_meeting_sessions_meeting_key on public.meeting_sessions(meeting_key);

create table if not exists public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_session_id uuid not null references public.meeting_sessions(id) on delete cascade,
  user_id uuid,
  role text,
  display_name text,
  join_socket_id text,
  leave_socket_id text,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  left_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_participants_session_id on public.meeting_participants(meeting_session_id);
create index if not exists idx_meeting_participants_user_id on public.meeting_participants(user_id);

create table if not exists public.meeting_events (
  id uuid primary key default gen_random_uuid(),
  meeting_session_id uuid not null references public.meeting_sessions(id) on delete cascade,
  user_id uuid,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_events_session_id on public.meeting_events(meeting_session_id);
create index if not exists idx_meeting_events_type on public.meeting_events(event_type);
create index if not exists idx_meeting_events_created_at on public.meeting_events(created_at);
