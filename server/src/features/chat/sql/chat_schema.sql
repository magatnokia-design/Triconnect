-- Run this in Supabase SQL editor to enable class chat.

create or replace function public.is_class_member(p_class_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.classes c
    where c.id = p_class_id
      and (
        c.teacher_id = p_user_id
        or exists (
          select 1
          from public.class_enrollments ce
          where ce.class_id = p_class_id
            and ce.student_id = p_user_id
        )
      )
  );
$$;

create table if not exists public.class_group_messages (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_class_group_messages_class_id
  on public.class_group_messages(class_id, created_at);
create index if not exists idx_class_group_messages_sender_id
  on public.class_group_messages(sender_id);

create table if not exists public.class_direct_threads (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, teacher_id, student_id)
);

create index if not exists idx_class_direct_threads_class_id
  on public.class_direct_threads(class_id);
create index if not exists idx_class_direct_threads_teacher
  on public.class_direct_threads(teacher_id);
create index if not exists idx_class_direct_threads_student
  on public.class_direct_threads(student_id);

create table if not exists public.class_direct_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.class_direct_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_class_direct_messages_thread_id
  on public.class_direct_messages(thread_id, created_at);
create index if not exists idx_class_direct_messages_sender_id
  on public.class_direct_messages(sender_id);

alter table public.class_group_messages enable row level security;
alter table public.class_direct_threads enable row level security;
alter table public.class_direct_messages enable row level security;

drop policy if exists class_group_messages_select on public.class_group_messages;
create policy class_group_messages_select
on public.class_group_messages
for select
using (public.is_class_member(class_id, auth.uid()));

drop policy if exists class_group_messages_insert on public.class_group_messages;
create policy class_group_messages_insert
on public.class_group_messages
for insert
with check (
  sender_id = auth.uid()
  and public.is_class_member(class_id, auth.uid())
);

drop policy if exists class_direct_threads_select on public.class_direct_threads;
create policy class_direct_threads_select
on public.class_direct_threads
for select
using (
  auth.uid() in (teacher_id, student_id)
  and public.is_class_member(class_id, auth.uid())
);

drop policy if exists class_direct_threads_insert on public.class_direct_threads;
create policy class_direct_threads_insert
on public.class_direct_threads
for insert
with check (
  public.is_class_member(class_id, auth.uid())
  and teacher_id = (select c.teacher_id from public.classes c where c.id = class_id)
  and auth.uid() in (teacher_id, student_id)
);

drop policy if exists class_direct_threads_update on public.class_direct_threads;
create policy class_direct_threads_update
on public.class_direct_threads
for update
using (
  public.is_class_member(class_id, auth.uid())
  and auth.uid() in (teacher_id, student_id)
)
with check (
  public.is_class_member(class_id, auth.uid())
  and teacher_id = (select c.teacher_id from public.classes c where c.id = class_id)
  and auth.uid() in (teacher_id, student_id)
);

drop policy if exists class_direct_messages_select on public.class_direct_messages;
create policy class_direct_messages_select
on public.class_direct_messages
for select
using (
  exists (
    select 1
    from public.class_direct_threads t
    where t.id = class_direct_messages.thread_id
      and auth.uid() in (t.teacher_id, t.student_id)
  )
);

drop policy if exists class_direct_messages_insert on public.class_direct_messages;
create policy class_direct_messages_insert
on public.class_direct_messages
for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.class_direct_threads t
    where t.id = class_direct_messages.thread_id
      and auth.uid() in (t.teacher_id, t.student_id)
  )
);

-- Required for realtime in Supabase.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'class_group_messages'
  ) then
    alter publication supabase_realtime add table public.class_group_messages;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'class_direct_messages'
  ) then
    alter publication supabase_realtime add table public.class_direct_messages;
  end if;
end $$;
