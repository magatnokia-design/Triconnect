-- Run this in Supabase SQL editor after existing class/assignment/module schema.
-- Adds assignment draft/scheduling metadata and chat attachment support.

alter table if exists public.assignments
  add column if not exists status text not null default 'published'
  check (status in ('draft', 'scheduled', 'published'));

alter table if exists public.assignments
  add column if not exists publish_at timestamptz;

create index if not exists idx_assignments_class_status_publish
  on public.assignments(class_id, status, publish_at);

alter table if exists public.class_group_messages
  add column if not exists attachment_url text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint;

alter table if exists public.class_direct_messages
  add column if not exists attachment_url text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint;

-- Chat storage bucket used for group and direct message attachments.
do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'chat-attachments'
  ) then
    insert into storage.buckets (id, name, public)
    values ('chat-attachments', 'chat-attachments', true);
  end if;
end $$;

drop policy if exists chat_attachments_select on storage.objects;
create policy chat_attachments_select
on storage.objects
for select
using (bucket_id = 'chat-attachments');

drop policy if exists chat_attachments_insert on storage.objects;
create policy chat_attachments_insert
on storage.objects
for insert
with check (
  bucket_id = 'chat-attachments'
  and auth.uid() is not null
);

drop policy if exists chat_attachments_update on storage.objects;
create policy chat_attachments_update
on storage.objects
for update
using (
  bucket_id = 'chat-attachments'
  and owner = auth.uid()
)
with check (
  bucket_id = 'chat-attachments'
  and owner = auth.uid()
);

drop policy if exists chat_attachments_delete on storage.objects;
create policy chat_attachments_delete
on storage.objects
for delete
using (
  bucket_id = 'chat-attachments'
  and owner = auth.uid()
);

-- Notifications support for modules, assignments, quizzes, meetings, and chat.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  class_id uuid references public.classes(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  target_path text not null,
  target_params jsonb not null default '{}'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_read_created
  on public.notifications(recipient_id, read_at, created_at desc);

create index if not exists idx_notifications_class_created
  on public.notifications(class_id, created_at desc);

create unique index if not exists idx_notifications_recipient_dedupe
  on public.notifications(recipient_id, dedupe_key)
  where dedupe_key is not null;

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
on public.notifications
for select
using (recipient_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
on public.notifications
for update
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own
on public.notifications
for delete
using (recipient_id = auth.uid());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create or replace function public.create_user_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_class_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_target_path text,
  p_target_params jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification_id uuid;
begin
  if p_recipient_id is null then
    return null;
  end if;

  if p_actor_id is not null and p_actor_id = p_recipient_id then
    return null;
  end if;

  insert into public.notifications (
    recipient_id,
    actor_id,
    class_id,
    type,
    title,
    body,
    target_path,
    target_params
  )
  values (
    p_recipient_id,
    p_actor_id,
    p_class_id,
    p_type,
    p_title,
    p_body,
    p_target_path,
    coalesce(p_target_params, '{}'::jsonb)
  )
  returning id into v_notification_id;

  return v_notification_id;
end;
$$;

create or replace function public.create_class_notification(
  p_class_id uuid,
  p_actor_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_target_path text,
  p_target_params jsonb default '{}'::jsonb,
  p_recipients text default 'students',
  p_debounce_seconds int default 0
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_count int := 0;
  v_bucket bigint;
  v_dedupe_key text;
begin
  if p_debounce_seconds > 0 then
    v_bucket := floor(extract(epoch from now()) / p_debounce_seconds);
  end if;

  for v_recipient in
    (
      select c.teacher_id as user_id
      from public.classes c
      where c.id = p_class_id
        and p_recipients in ('teacher', 'all')

      union

      select ce.student_id as user_id
      from public.class_enrollments ce
      where ce.class_id = p_class_id
        and p_recipients in ('students', 'all')
    )
  loop
    if p_actor_id is not null and p_actor_id = v_recipient then
      continue;
    end if;

    v_dedupe_key := null;
    if p_debounce_seconds > 0 then
      v_dedupe_key := p_type || ':' || p_class_id || ':' || coalesce(p_actor_id::text, 'system') || ':' || v_bucket::text;
    end if;

    insert into public.notifications (
      recipient_id,
      actor_id,
      class_id,
      type,
      title,
      body,
      target_path,
      target_params,
      dedupe_key
    )
    values (
      v_recipient,
      p_actor_id,
      p_class_id,
      p_type,
      p_title,
      p_body,
      p_target_path,
      coalesce(p_target_params, '{}'::jsonb),
      v_dedupe_key
    )
    on conflict do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.publish_due_assignments_and_notify()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    update public.assignments a
    set status = 'published'
    where a.status = 'scheduled'
      and a.publish_at is not null
      and a.publish_at <= now()
    returning a.id, a.class_id, a.teacher_id, a.title
  loop
    perform public.create_class_notification(
      v_row.class_id,
      v_row.teacher_id,
      'assignment_published',
      'New assignment published',
      v_row.title,
      '/classes/' || v_row.class_id || '?tab=Assignments',
      jsonb_build_object('assignmentId', v_row.id),
      'students',
      0
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.create_user_notification(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb
) to authenticated;

grant execute on function public.create_class_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  int
) to authenticated;

-- Optional: auto-publish scheduled assignments every minute.
-- Run this section once in Supabase SQL editor after the function above exists.
create extension if not exists pg_cron;

do $$
declare
  v_existing_job_id bigint;
begin
  select jobid
  into v_existing_job_id
  from cron.job
  where jobname = 'publish-due-assignments-every-minute'
  limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'publish-due-assignments-every-minute',
    '* * * * *',
    'select public.publish_due_assignments_and_notify();'
  );
end;
$$;
