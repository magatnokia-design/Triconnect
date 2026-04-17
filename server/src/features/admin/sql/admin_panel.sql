-- Run this in Supabase SQL editor to support secure admin panel workflows.

alter table if exists public.profiles
  add column if not exists account_status text not null default 'active'
  check (account_status in ('active', 'deactivated'));

alter table if exists public.profiles
  add column if not exists status_reason text,
  add column if not exists status_changed_by uuid references public.profiles(id) on delete set null,
  add column if not exists status_changed_at timestamptz;

alter table if exists public.classes
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists posting_locked boolean not null default false,
  add column if not exists posting_locked_at timestamptz,
  add column if not exists posting_locked_by uuid references public.profiles(id) on delete set null;

create table if not exists public.content_flags (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references public.classes(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  reason text not null,
  details text,
  status text not null default 'open',
  created_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_content_flags_status_created
  on public.content_flags(status, created_at desc);

create index if not exists idx_content_flags_entity
  on public.content_flags(entity_type, entity_id);

alter table public.content_flags enable row level security;

drop policy if exists content_flags_select_admin_only on public.content_flags;
create policy content_flags_select_admin_only
on public.content_flags
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists content_flags_insert_deny on public.content_flags;
create policy content_flags_insert_deny
on public.content_flags
for insert
with check (false);

drop policy if exists content_flags_update_deny on public.content_flags;
create policy content_flags_update_deny
on public.content_flags
for update
using (false)
with check (false);

create or replace function public.admin_revoke_user_sessions(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
begin
  begin
    delete from auth.sessions s
    where s.user_id = p_user_id;
    get diagnostics v_deleted = row_count;
  exception when undefined_table then
    delete from auth.refresh_tokens rt
    where rt.user_id = p_user_id;
    get diagnostics v_deleted = row_count;
  end;

  return v_deleted;
end;
$$;

grant execute on function public.admin_revoke_user_sessions(uuid) to authenticated;

create or replace function public.enforce_class_posting_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id uuid;
  v_archived boolean;
  v_locked boolean;
begin
  v_class_id := coalesce(new.class_id, old.class_id);
  if v_class_id is null then
    return new;
  end if;

  select c.is_archived, c.posting_locked
  into v_archived, v_locked
  from public.classes c
  where c.id = v_class_id;

  if coalesce(v_archived, false) then
    raise exception 'Class is archived; content posting is disabled.';
  end if;

  if coalesce(v_locked, false) then
    raise exception 'Class posting is locked by admin.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_modules_posting_guard on public.modules;
create trigger trg_modules_posting_guard
before insert or update on public.modules
for each row execute function public.enforce_class_posting_guard();

drop trigger if exists trg_assignments_posting_guard on public.assignments;
create trigger trg_assignments_posting_guard
before insert or update on public.assignments
for each row execute function public.enforce_class_posting_guard();

drop trigger if exists trg_quizzes_posting_guard on public.quizzes;
create trigger trg_quizzes_posting_guard
before insert or update on public.quizzes
for each row execute function public.enforce_class_posting_guard();

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  target_type text not null,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_actor
  on public.admin_audit_logs(actor_id, created_at desc);

create index if not exists idx_admin_audit_logs_target
  on public.admin_audit_logs(target_type, target_id, created_at desc);

alter table public.admin_audit_logs enable row level security;

drop policy if exists admin_audit_logs_select_admin_only on public.admin_audit_logs;
create policy admin_audit_logs_select_admin_only
on public.admin_audit_logs
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- Writes are done with service key on server; keep client direct writes blocked by RLS.
drop policy if exists admin_audit_logs_insert_deny on public.admin_audit_logs;
create policy admin_audit_logs_insert_deny
on public.admin_audit_logs
for insert
with check (false);
