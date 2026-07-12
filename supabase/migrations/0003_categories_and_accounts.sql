-- Phase 3: financial accounts, categories/subcategories (with per-workspace
-- defaults copied from a global template), payment methods.

-- ── Enums ────────────────────────────────────────────────────────────────

create type account_type as enum (
  'checking', 'cash', 'digital_wallet', 'savings',
  'investment', 'credit_card', 'project', 'other');

create type category_kind as enum ('income', 'expense', 'project_cost');

create type payment_method_kind as enum (
  'pix', 'boleto', 'bank_transfer', 'debit', 'credit',
  'credit_installments', 'cash', 'auto_debit', 'other');

create type pix_key_type as enum ('cpf', 'cnpj', 'email', 'phone', 'random');

-- ── Tables ───────────────────────────────────────────────────────────────

create table financial_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  type account_type not null default 'checking',
  institution text,
  initial_balance numeric(14,2) not null default 0,
  credit_limit numeric(14,2) check (credit_limit >= 0),
  color text,
  icon text,
  note text,
  archived_at timestamptz,
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index financial_accounts_workspace_idx
  on financial_accounts (workspace_id) where deleted_at is null;
create unique index financial_accounts_name_key
  on financial_accounts (workspace_id, lower(name))
  where archived_at is null and deleted_at is null;

create table categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kind category_kind not null,
  name text not null check (char_length(trim(name)) between 1 and 60),
  icon text,
  color text,
  sort_order int not null default 0,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_workspace_idx on categories (workspace_id, kind);
create unique index categories_name_key
  on categories (workspace_id, kind, lower(name))
  where archived_at is null;

create table subcategories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  category_id uuid not null references categories (id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 60),
  icon text,
  color text,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subcategories_category_idx on subcategories (category_id);
create index subcategories_workspace_idx on subcategories (workspace_id);
create unique index subcategories_name_key
  on subcategories (category_id, lower(name))
  where archived_at is null;

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kind payment_method_kind not null,
  label text not null check (char_length(trim(label)) between 1 and 60),
  account_id uuid references financial_accounts (id),
  card_last4 char(4) check (card_last4 ~ '^[0-9]{4}$'),
  note text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_methods_workspace_idx on payment_methods (workspace_id);

-- Global template of default categories (copied into each new workspace).
create table category_templates (
  id uuid primary key default gen_random_uuid(),
  kind category_kind not null,
  name text not null,
  icon text,
  color text,
  sort_order int not null default 0,
  unique (kind, name)
);

-- ── Triggers ─────────────────────────────────────────────────────────────

create trigger set_updated_at before update on financial_accounts
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on categories
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on subcategories
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on payment_methods
  for each row execute function app.set_updated_at();

create trigger prevent_workspace_change before update on financial_accounts
  for each row execute function app.prevent_workspace_change();
create trigger prevent_workspace_change before update on categories
  for each row execute function app.prevent_workspace_change();
create trigger prevent_workspace_change before update on subcategories
  for each row execute function app.prevent_workspace_change();
create trigger prevent_workspace_change before update on payment_methods
  for each row execute function app.prevent_workspace_change();

-- Subcategory must belong to a category of the same workspace.
create function app.check_subcategory_consistency()
returns trigger
language plpgsql
as $$
declare
  parent_workspace uuid;
begin
  select workspace_id into parent_workspace
  from categories where id = new.category_id;

  if parent_workspace is null or parent_workspace <> new.workspace_id then
    raise exception 'subcategory must belong to a category of the same workspace';
  end if;
  return new;
end;
$$;

create trigger check_subcategory_consistency
  before insert or update on subcategories
  for each row execute function app.check_subcategory_consistency();

-- ── Default categories: 16 expense categories of the method ─────────────

insert into category_templates (kind, name, icon, color, sort_order) values
  ('expense', 'Moradia', 'House', '#2563eb', 1),
  ('expense', 'Transporte', 'Car', '#0891b2', 2),
  ('expense', 'Alimentação', 'UtensilsCrossed', '#16a34a', 3),
  ('expense', 'Saúde e Beleza', 'HeartPulse', '#dc2626', 4),
  ('expense', 'Despesas Básicas', 'Receipt', '#64748b', 5),
  ('expense', 'Desenvolvimento Pessoal', 'GraduationCap', '#7c3aed', 6),
  ('expense', 'Lazer', 'Popcorn', '#ea580c', 7),
  ('expense', 'Sistemas e Apps', 'MonitorSmartphone', '#0d9488', 8),
  ('expense', 'Vestuários e Calçados', 'Shirt', '#db2777', 9),
  ('expense', 'Comemorações e Presentes', 'Gift', '#e11d48', 10),
  ('expense', 'Secretária e Empregada', 'Users', '#a16207', 11),
  ('expense', 'Filhos e Familiares', 'Baby', '#9333ea', 12),
  ('expense', 'Financeiras', 'Landmark', '#475569', 13),
  ('expense', 'Dízimos e Ofertas', 'HandHeart', '#ca8a04', 14),
  ('expense', 'Doações', 'HandCoins', '#059669', 15),
  ('expense', 'Doações para Familiares', 'HeartHandshake', '#0284c7', 16)
on conflict (kind, name) do nothing;

-- ── Workspace bootstrap now also copies default categories ──────────────

create or replace function app.handle_new_workspace()
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

  insert into categories (workspace_id, kind, name, icon, color, sort_order, is_default)
  select new.id, t.kind, t.name, t.icon, t.color, t.sort_order, true
  from category_templates t
  on conflict do nothing;

  insert into audit_logs (workspace_id, user_id, action, entity_type, entity_id, summary)
  values (new.id, new.owner_id, 'workspace.created', 'workspace', new.id,
          'Espaço financeiro criado');

  return new;
end;
$$;

-- Backfill: workspaces created before this migration receive the defaults.
insert into categories (workspace_id, kind, name, icon, color, sort_order, is_default)
select w.id, t.kind, t.name, t.icon, t.color, t.sort_order, true
from workspaces w
cross join category_templates t
where not exists (
  select 1 from categories c
  where c.workspace_id = w.id and c.kind = t.kind and lower(c.name) = lower(t.name)
);

-- ── Row Level Security ───────────────────────────────────────────────────

alter table financial_accounts enable row level security;
alter table categories enable row level security;
alter table subcategories enable row level security;
alter table payment_methods enable row level security;
alter table category_templates enable row level security;

-- financial_accounts: members read; owner manages.
-- (Contas não fazem parte do catálogo de permissões concedíveis — decisão
-- documentada em PROJECT_SPEC: gestão de contas é do proprietário.)
create policy accounts_select on financial_accounts for select
  using (app.is_member(workspace_id) and deleted_at is null);
create policy accounts_insert on financial_accounts for insert
  with check (app.is_owner(workspace_id) and created_by = auth.uid());
create policy accounts_update on financial_accounts for update
  using (app.is_owner(workspace_id)) with check (app.is_owner(workspace_id));
create policy accounts_delete on financial_accounts for delete
  using (app.is_owner(workspace_id));

-- categories/subcategories: members read; escrita exige edit_categories
-- (owner sempre passa em app.has_permission).
create policy categories_select on categories for select
  using (app.is_member(workspace_id));
create policy categories_insert on categories for insert
  with check (app.has_permission(workspace_id, 'edit_categories'));
create policy categories_update on categories for update
  using (app.has_permission(workspace_id, 'edit_categories'))
  with check (app.has_permission(workspace_id, 'edit_categories'));
create policy categories_delete on categories for delete
  using (app.has_permission(workspace_id, 'edit_categories'));

create policy subcategories_select on subcategories for select
  using (app.is_member(workspace_id));
create policy subcategories_insert on subcategories for insert
  with check (app.has_permission(workspace_id, 'edit_categories'));
create policy subcategories_update on subcategories for update
  using (app.has_permission(workspace_id, 'edit_categories'))
  with check (app.has_permission(workspace_id, 'edit_categories'));
create policy subcategories_delete on subcategories for delete
  using (app.has_permission(workspace_id, 'edit_categories'));

-- payment_methods: qualquer membro ativo gerencia (assistentes cadastram
-- dados de pagamento por padrão).
create policy payment_methods_select on payment_methods for select
  using (app.is_member(workspace_id));
create policy payment_methods_insert on payment_methods for insert
  with check (app.is_member(workspace_id));
create policy payment_methods_update on payment_methods for update
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));
create policy payment_methods_delete on payment_methods for delete
  using (app.is_owner(workspace_id));

-- category_templates: catálogo global somente leitura.
create policy category_templates_select on category_templates for select
  to authenticated using (true);

-- ── Grants ───────────────────────────────────────────────────────────────

revoke all on financial_accounts, categories, subcategories,
  payment_methods, category_templates from anon;
grant select, insert, update, delete on financial_accounts, categories,
  subcategories, payment_methods to authenticated;
grant select on category_templates to authenticated;
