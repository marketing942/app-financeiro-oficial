-- Phase 2: workspaces, members, invitations, permissions, settings, audit.
-- Every table here has RLS enabled. Authorization helpers live in `app`
-- and are checked on every query, so revocation takes effect immediately.

-- ── Enums ────────────────────────────────────────────────────────────────

create type member_role as enum ('owner', 'assistant');
create type member_status as enum ('active', 'revoked');
create type invitation_status as enum ('pending', 'accepted', 'expired', 'revoked');

-- ── Tables ───────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  timezone text not null default 'America/Recife',
  locale text not null default 'pt-BR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  owner_id uuid not null references profiles (id),
  currency text not null default 'BRL',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role member_role not null default 'assistant',
  status member_status not null default 'active',
  permissions jsonb not null default '{}',
  invited_by uuid references profiles (id),
  last_access_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_idx
  on workspace_members (user_id) where status = 'active';
create index workspace_members_workspace_idx on workspace_members (workspace_id);

create table workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role member_role not null default 'assistant' check (role <> 'owner'),
  permissions jsonb not null default '{}',
  token_hash text not null unique,
  status invitation_status not null default 'pending',
  expires_at timestamptz not null,
  invited_by uuid not null references profiles (id),
  accepted_by uuid references profiles (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_invitations_workspace_idx
  on workspace_invitations (workspace_id);

create table role_permissions (
  id uuid primary key default gen_random_uuid(),
  role member_role not null,
  permission text not null,
  granted boolean not null default false,
  unique (role, permission)
);

create table user_preferences (
  user_id uuid primary key references profiles (id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  privacy_mode boolean not null default false,
  dashboard_prefs jsonb not null default '{}',
  nylo_prefs jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_settings (
  workspace_id uuid primary key references workspaces (id) on delete cascade,
  month_start_day int not null default 1 check (month_start_day between 1 and 28),
  default_tolerance numeric(5,2) not null default 0 check (default_tolerance >= 0),
  alert_threshold numeric(5,2) not null default 80 check (alert_threshold between 0 and 100),
  essential_category_ids uuid[] not null default '{}',
  dashboard_prefs jsonb not null default '{}',
  nylo_history_enabled boolean not null default true,
  nylo_retention_days int not null default 90 check (nylo_retention_days between 1 and 3650),
  nylo_monthly_message_limit int check (nylo_monthly_message_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid references profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_logs_workspace_idx on audit_logs (workspace_id, created_at desc);

-- ── updated_at triggers ──────────────────────────────────────────────────

create trigger set_updated_at before update on profiles
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on workspaces
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on workspace_members
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on workspace_invitations
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on user_preferences
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on workspace_settings
  for each row execute function app.set_updated_at();

-- ── Authorization helpers (checked on EVERY query via RLS) ───────────────

create function app.is_member(ws uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create function app.is_owner(ws uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'owner'
  );
$$;

create function app.has_permission(ws uuid, perm text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (
        m.role = 'owner'
        or coalesce(
             (m.permissions ->> perm)::boolean,
             (select rp.granted from role_permissions rp
               where rp.role = m.role and rp.permission = perm),
             false
           )
      )
  );
$$;

-- Two profiles are visible to each other when they share an active workspace.
create function app.shares_workspace(profile_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from workspace_members mine
    join workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = profile_id
      and theirs.status = 'active'
  );
$$;

grant execute on function app.is_member(uuid) to authenticated, anon;
grant execute on function app.is_owner(uuid) to authenticated, anon;
grant execute on function app.has_permission(uuid, text) to authenticated, anon;
grant execute on function app.shares_workspace(uuid) to authenticated, anon;

-- ── Audit helper (append-only writes from definer functions) ─────────────

create function app.log_audit(
  ws uuid,
  action text,
  entity_type text,
  entity_id uuid,
  summary text,
  metadata jsonb default '{}'
)
returns void
language sql security definer
set search_path = public
as $$
  insert into audit_logs (workspace_id, user_id, action, entity_type, entity_id, summary, metadata)
  values (ws, auth.uid(), action, entity_type, entity_id, summary, coalesce(metadata, '{}'));
$$;

grant execute on function app.log_audit(uuid, text, text, uuid, text, jsonb) to authenticated;

-- ── Protection triggers ──────────────────────────────────────────────────

-- workspace_id is immutable on every workspace-scoped table.
create function app.prevent_workspace_change()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id is immutable';
  end if;
  return new;
end;
$$;

create trigger prevent_workspace_change before update on workspace_members
  for each row execute function app.prevent_workspace_change();
create trigger prevent_workspace_change before update on workspace_invitations
  for each row execute function app.prevent_workspace_change();

-- The owner membership can never be removed, revoked or demoted.
create function app.protect_owner_membership()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      raise exception 'the workspace owner membership cannot be removed';
    end if;
    return old;
  end if;
  if old.role = 'owner'
     and (new.role <> 'owner' or new.status <> 'active') then
    raise exception 'the workspace owner cannot be demoted or revoked';
  end if;
  return new;
end;
$$;

create trigger protect_owner_membership
  before update or delete on workspace_members
  for each row execute function app.protect_owner_membership();

-- ── Bootstrap: new auth user → profile, preferences, personal workspace ──

create function app.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  display_name text;
begin
  display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'usuario'), '@', 1)
  );

  insert into profiles (id, full_name) values (new.id, display_name)
  on conflict (id) do nothing;

  insert into user_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into workspaces (name, owner_id)
  values ('Espaço de ' || display_name, new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- New workspace → owner membership, settings, audit entry.
-- Phase 3 extends this function with default categories seeding.
create function app.handle_new_workspace()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into workspace_members (workspace_id, user_id, role, status)
  values (new.id, new.owner_id, 'owner', 'active')
  on conflict (workspace_id, user_id) do nothing;

  insert into workspace_settings (workspace_id) values (new.id)
  on conflict (workspace_id) do nothing;

  insert into audit_logs (workspace_id, user_id, action, entity_type, entity_id, summary)
  values (new.id, new.owner_id, 'workspace.created', 'workspace', new.id,
          'Espaço financeiro criado');

  return new;
end;
$$;

create trigger on_workspace_created
  after insert on workspaces
  for each row execute function app.handle_new_workspace();

-- ── Invitations: acceptance and preview (token = authorization) ──────────

create function public.accept_invitation(invitation_token text)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  user_email text;
  inv workspace_invitations%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select lower(email) into user_email from auth.users where id = uid;

  select * into inv
  from workspace_invitations
  where token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'invitation_not_found';
  end if;
  if inv.status = 'revoked' then
    raise exception 'invitation_revoked';
  end if;
  if inv.status = 'accepted' then
    raise exception 'invitation_already_accepted';
  end if;
  if inv.expires_at < now() then
    update workspace_invitations set status = 'expired' where id = inv.id;
    raise exception 'invitation_expired';
  end if;
  if inv.email <> user_email then
    raise exception 'invitation_email_mismatch';
  end if;

  insert into workspace_members (workspace_id, user_id, role, status, permissions, invited_by)
  values (inv.workspace_id, uid, inv.role, 'active', coalesce(inv.permissions, '{}'), inv.invited_by)
  on conflict (workspace_id, user_id) do update
    set status = 'active',
        role = excluded.role,
        permissions = excluded.permissions,
        revoked_at = null;

  update workspace_invitations
  set status = 'accepted', accepted_by = uid, accepted_at = now()
  where id = inv.id;

  perform app.log_audit(
    inv.workspace_id, 'invitation.accepted', 'workspace_invitation', inv.id,
    'Convite aceito', jsonb_build_object('email', inv.email)
  );

  return inv.workspace_id;
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;

create function public.get_invitation_preview(invitation_token text)
returns table (
  workspace_name text,
  inviter_name text,
  invited_email text,
  status invitation_status,
  expires_at timestamptz
)
language sql stable security definer
set search_path = public, extensions
as $$
  select
    w.name,
    p.full_name,
    i.email,
    case
      when i.status = 'pending' and i.expires_at < now() then 'expired'::invitation_status
      else i.status
    end,
    i.expires_at
  from workspace_invitations i
  join workspaces w on w.id = i.workspace_id
  join profiles p on p.id = i.invited_by
  where i.token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex');
$$;

grant execute on function public.get_invitation_preview(text) to anon, authenticated;

-- Throttled "last access" touch (assistants cannot edit their own row).
create function public.touch_workspace_access(ws uuid)
returns void
language sql security definer
set search_path = public
as $$
  update workspace_members
  set last_access_at = now()
  where workspace_id = ws
    and user_id = auth.uid()
    and status = 'active'
    and (last_access_at is null or last_access_at < now() - interval '5 minutes');
$$;

grant execute on function public.touch_workspace_access(uuid) to authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────

alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table workspace_invitations enable row level security;
alter table role_permissions enable row level security;
alter table user_preferences enable row level security;
alter table workspace_settings enable row level security;
alter table audit_logs enable row level security;

-- profiles
create policy profiles_select on profiles for select
  using (id = auth.uid() or app.shares_workspace(id));
create policy profiles_insert on profiles for insert
  with check (id = auth.uid());
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- workspaces
create policy workspaces_select on workspaces for select
  using (app.is_member(id) and deleted_at is null);
create policy workspaces_insert on workspaces for insert
  with check (owner_id = auth.uid());
create policy workspaces_update on workspaces for update
  using (app.is_owner(id)) with check (app.is_owner(id) and owner_id = auth.uid());
create policy workspaces_delete on workspaces for delete
  using (app.is_owner(id));

-- workspace_members
create policy members_select on workspace_members for select
  using (app.is_member(workspace_id));
create policy members_insert on workspace_members for insert
  with check (app.is_owner(workspace_id));
create policy members_update on workspace_members for update
  using (app.is_owner(workspace_id)) with check (app.is_owner(workspace_id));
create policy members_delete on workspace_members for delete
  using (app.is_owner(workspace_id));

-- workspace_invitations (management is owner-only; acceptance via function)
create policy invitations_select on workspace_invitations for select
  using (app.is_owner(workspace_id));
create policy invitations_insert on workspace_invitations for insert
  with check (app.is_owner(workspace_id) and invited_by = auth.uid());
create policy invitations_update on workspace_invitations for update
  using (app.is_owner(workspace_id)) with check (app.is_owner(workspace_id));
create policy invitations_delete on workspace_invitations for delete
  using (app.is_owner(workspace_id));

-- role_permissions (read-only catalog)
create policy role_permissions_select on role_permissions for select
  to authenticated using (true);

-- user_preferences
create policy preferences_select on user_preferences for select
  using (user_id = auth.uid());
create policy preferences_insert on user_preferences for insert
  with check (user_id = auth.uid());
create policy preferences_update on user_preferences for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- workspace_settings
create policy settings_select on workspace_settings for select
  using (app.is_member(workspace_id));
create policy settings_insert on workspace_settings for insert
  with check (app.is_owner(workspace_id));
create policy settings_update on workspace_settings for update
  using (app.is_owner(workspace_id)) with check (app.is_owner(workspace_id));

-- audit_logs: append-only. Owner reads; members insert their own entries.
-- No update/delete policies exist — not even for the owner.
create policy audit_select on audit_logs for select
  using (app.is_owner(workspace_id));
create policy audit_insert on audit_logs for insert
  with check (app.is_member(workspace_id) and user_id = auth.uid());

-- ── Grants (RLS is the gate; anon gets nothing on tables) ────────────────

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on profiles, workspaces, workspace_members,
  workspace_invitations, user_preferences, workspace_settings to authenticated;
grant select on role_permissions to authenticated;
grant select, insert on audit_logs to authenticated;

-- ── Assistant permission catalog (defaults; owner always passes) ─────────

insert into role_permissions (role, permission, granted) values
  ('assistant', 'delete_transactions', false),
  ('assistant', 'edit_categories', false),
  ('assistant', 'edit_goals', false),
  ('assistant', 'edit_assets', false),
  ('assistant', 'edit_investments', false),
  ('assistant', 'edit_liabilities', false),
  ('assistant', 'edit_projects', false),
  ('assistant', 'export_reports', false),
  ('assistant', 'view_full_payment_data', false),
  ('assistant', 'use_nylo_advanced', false)
on conflict (role, permission) do nothing;
