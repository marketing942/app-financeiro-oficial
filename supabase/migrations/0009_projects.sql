-- Phase 9: business projects. Costs, incomes and contributions live in
-- transactions (single source of truth) under dedicated natures with
-- project_id, so they NEVER leak into personal consumption aggregates.
-- Indicators (capital, cost, result, margin, ROI) are always computed by
-- project_financials() — never stored.

create type project_status as enum (
  'planning', 'in_progress', 'paused', 'ready_for_sale',
  'sold', 'completed', 'canceled');

create type project_type as enum (
  'construction_for_sale', 'buy_and_renovate', 'vehicle_trade',
  'land', 'venture', 'commercial', 'other');

create type stage_status as enum ('pending', 'in_progress', 'done', 'skipped');

create type project_cost_kind as enum (
  'direct', 'tax', 'commission', 'fee', 'selling_expense');

create table business_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  type project_type not null,
  description text,
  start_date date,
  expected_end_date date,
  end_date date,
  budget numeric(14,2) check (budget >= 0),
  initial_capital numeric(14,2) check (initial_capital >= 0),
  expected_sale_value numeric(14,2) check (expected_sale_value >= 0),
  status project_status not null default 'planning',
  responsible_id uuid references profiles (id),
  note text,
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index business_projects_ws_idx on business_projects (workspace_id)
  where deleted_at is null;

create table project_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id uuid not null references business_projects (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  sort_order int not null default 0,
  start_date date,
  end_date date,
  status stage_status not null default 'pending',
  note text,
  created_at timestamptz not null default now()
);

create index project_stages_project_idx
  on project_stages (project_id, sort_order);

-- Categorias de custo do projeto. kind separa custo direto (resultado
-- bruto) de impostos/comissões/taxas/despesas de venda (resultado líquido).
create table project_cost_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id uuid not null references business_projects (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  kind project_cost_kind not null default 'direct',
  sort_order int not null default 0,
  unique (project_id, name)
);

create index project_cost_categories_project_idx
  on project_cost_categories (project_id, sort_order);

create table project_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id uuid not null references business_projects (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  storage_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  uploaded_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table project_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id uuid not null references business_projects (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create trigger set_updated_at before update on business_projects
  for each row execute function app.set_updated_at();
create trigger prevent_workspace_change before update on business_projects
  for each row execute function app.prevent_workspace_change();

-- Vínculos das entidades existentes com projetos.
alter table transactions
  add column project_cost_category_id uuid
    references project_cost_categories (id) on delete set null,
  add constraint transactions_project_fk
    foreign key (project_id) references business_projects (id)
    on delete set null,
  -- Naturezas de projeto SEMPRE têm projeto; project_id só nas naturezas
  -- de projeto, aporte e na distribuição de lucro (income por referência).
  add constraint transactions_project_nature_check check (
    nature not in ('project_cost', 'project_income')
    or project_id is not null),
  add constraint transactions_project_link_check check (
    project_id is null
    or nature in ('project_cost', 'project_income',
                  'investment_contribution', 'income'));

alter table liabilities
  add constraint liabilities_project_fk
    foreign key (project_id) references business_projects (id)
    on delete set null;

alter table assets
  add constraint assets_project_fk
    foreign key (project_id) references business_projects (id)
    on delete set null;

-- Presets de categorias de custo por tipo de projeto.
create function app.seed_project_cost_categories()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.type in ('construction_for_sale', 'buy_and_renovate') then
    insert into project_cost_categories
      (workspace_id, project_id, name, kind, sort_order)
    values
      (new.workspace_id, new.id, 'Terreno', 'direct', 1),
      (new.workspace_id, new.id, 'Material', 'direct', 2),
      (new.workspace_id, new.id, 'Mão de obra', 'direct', 3),
      (new.workspace_id, new.id, 'Projetos e documentação', 'fee', 4),
      (new.workspace_id, new.id, 'Impostos', 'tax', 5),
      (new.workspace_id, new.id, 'Comissão de venda', 'commission', 6),
      (new.workspace_id, new.id, 'Despesas de venda', 'selling_expense', 7);
  elsif new.type = 'vehicle_trade' then
    insert into project_cost_categories
      (workspace_id, project_id, name, kind, sort_order)
    values
      (new.workspace_id, new.id, 'Aquisição', 'direct', 1),
      (new.workspace_id, new.id, 'Peças e reforma', 'direct', 2),
      (new.workspace_id, new.id, 'Documentação e transferência', 'fee', 3),
      (new.workspace_id, new.id, 'Impostos', 'tax', 4),
      (new.workspace_id, new.id, 'Comissão de venda', 'commission', 5);
  else
    insert into project_cost_categories
      (workspace_id, project_id, name, kind, sort_order)
    values
      (new.workspace_id, new.id, 'Custos gerais', 'direct', 1),
      (new.workspace_id, new.id, 'Impostos', 'tax', 2),
      (new.workspace_id, new.id, 'Taxas', 'fee', 3);
  end if;
  return new;
end;
$$;

create trigger on_project_created
  after insert on business_projects
  for each row execute function app.seed_project_cost_categories();

-- Lançamentos do projeto (view, não tabela — evita dupla contabilização).
create view project_transactions
with (security_invoker = true) as
  select t.*
    from transactions t
   where t.project_id is not null
     and t.nature in ('project_cost', 'project_income',
                      'investment_contribution')
     and t.deleted_at is null;

-- ── Indicadores (CALCULATIONS §6) — sempre calculados ────────────────────

create function public.project_financials(p_workspace uuid)
returns table (
  project_id uuid,
  planned_cost numeric(14,2),
  actual_cost numeric(14,2),
  direct_cost_actual numeric(14,2),
  deduction_cost_actual numeric(14,2),
  capital_invested numeric(14,2),
  revenue_actual numeric(14,2),
  gross_result numeric(14,2),
  net_result numeric(14,2),
  net_margin numeric(7,2),
  return_on_capital numeric(7,2)
)
language sql stable
as $$
  with tx as (
    select t.project_id,
           t.nature,
           t.status,
           t.planned_amount,
           coalesce(t.net_amount_actual, t.actual_amount) as actual_net,
           t.actual_amount,
           coalesce(c.kind, 'direct') as cost_kind
      from transactions t
      left join project_cost_categories c
        on c.id = t.project_cost_category_id
     where t.workspace_id = p_workspace
       and app.is_member(t.workspace_id)
       and t.deleted_at is null
       and t.project_id is not null
  ),
  agg as (
    select p.id as pid,
           coalesce(sum(tx.planned_amount) filter (
             where tx.nature = 'project_cost'
               and tx.status not in ('canceled')), 0)::numeric(14,2) as planned_cost,
           coalesce(sum(tx.actual_amount) filter (
             where tx.nature = 'project_cost'
               and tx.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as actual_cost,
           coalesce(sum(tx.actual_amount) filter (
             where tx.nature = 'project_cost'
               and tx.cost_kind = 'direct'
               and tx.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as direct_cost,
           coalesce(sum(tx.actual_amount) filter (
             where tx.nature = 'investment_contribution'
               and tx.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as capital,
           coalesce(sum(tx.actual_net) filter (
             where tx.nature = 'project_income'
               and tx.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as revenue
      from business_projects p
      left join tx on tx.project_id = p.id
     where p.workspace_id = p_workspace
       and app.is_member(p.workspace_id)
       and p.deleted_at is null
     group by p.id
  )
  select a.pid,
         a.planned_cost,
         a.actual_cost,
         a.direct_cost,
         (a.actual_cost - a.direct_cost)::numeric(14,2),
         a.capital,
         a.revenue,
         (a.revenue - a.direct_cost)::numeric(14,2),
         (a.revenue - a.actual_cost)::numeric(14,2),
         case when a.revenue > 0
              then round((a.revenue - a.actual_cost) / a.revenue * 100, 2)
              else null end,
         case when a.capital > 0
              then round((a.revenue - a.actual_cost) / a.capital * 100, 2)
              else null end
    from agg a;
$$;

grant execute on function public.project_financials(uuid) to authenticated;

-- Exclusão lógica auditada (a policy de update não permite setar
-- deleted_at diretamente — mesmo padrão de soft_delete_transaction).
create function public.soft_delete_project(p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  p business_projects%rowtype;
begin
  select * into p from business_projects
   where id = p_id and deleted_at is null
   for update;
  if not found then
    return false;
  end if;
  if not app.has_permission(p.workspace_id, 'edit_projects') then
    raise exception 'not_authorized';
  end if;

  update business_projects
     set deleted_at = now(), updated_by = auth.uid()
   where id = p_id;

  perform app.log_audit(p.workspace_id, 'project.deleted',
    'business_project', p_id,
    'Projeto "' || p.name || '" excluído (exclusão lógica)');

  return true;
end;
$$;

grant execute on function public.soft_delete_project(uuid) to authenticated;

-- Metas do tipo 'project' passam a ler o resultado líquido do projeto
-- vinculado (a Fase 8 deixou o tipo com valor 0 até aqui).
create or replace function app.goal_project_value(g goals)
returns numeric(14,2)
language sql stable
as $$
  select coalesce((
    select f.net_result
      from project_financials(g.workspace_id) f
     where g.related_entity_type = 'project'
       and f.project_id = g.related_entity_id
  ), 0)::numeric(14,2);
$$;

create or replace function app.goal_current_value(g goals)
returns numeric(14,2)
language sql stable
as $$
  select case g.type
    when 'income' then (
      select coalesce(sum(coalesce(t.net_amount_actual, t.actual_amount)), 0)
        from transactions t
       where t.workspace_id = g.workspace_id
         and t.nature = 'income'
         and t.status in ('realized', 'partially_realized')
         and t.deleted_at is null
         and t.competence_month >= date_trunc('month', g.start_date)::date
         and t.competence_month <= g.end_date
         and (g.related_entity_type is distinct from 'category'
              or t.category_id = g.related_entity_id))
    when 'expense_limit' then (
      select coalesce(sum(t.actual_amount), 0)
        from transactions t
       where t.workspace_id = g.workspace_id
         and t.nature in ('consumer_expense', 'consumer_financing')
         and t.status in ('realized', 'partially_realized')
         and t.deleted_at is null
         and t.competence_month >= date_trunc('month', g.start_date)::date
         and t.competence_month <= g.end_date
         and (g.related_entity_type is distinct from 'category'
              or t.category_id = g.related_entity_id))
    when 'contribution' then (
      select coalesce(sum(t.actual_amount), 0)
        from transactions t
       where t.workspace_id = g.workspace_id
         and t.nature = 'investment_contribution'
         and t.status in ('realized', 'partially_realized')
         and t.deleted_at is null
         and t.competence_month >= date_trunc('month', g.start_date)::date
         and t.competence_month <= g.end_date
         and (g.related_entity_type is distinct from 'investment'
              or t.investment_id = g.related_entity_id))
    when 'reserve' then (
      select coalesce(sum(i.current_balance), 0)
        from investments i
       where i.workspace_id = g.workspace_id
         and i.deleted_at is null and i.archived_at is null
         and case
               when g.related_entity_type = 'investment'
                 then i.id = g.related_entity_id
               else i.investment_group = 'emergency_opportunity'
             end)
    when 'investment' then (
      select coalesce(sum(i.current_balance), 0)
        from investments i
       where i.workspace_id = g.workspace_id
         and i.deleted_at is null and i.archived_at is null
         and (g.related_entity_type is distinct from 'investment'
              or i.id = g.related_entity_id))
    when 'acquisition' then (
      select coalesce(sum(i.current_balance), 0)
        from investments i
       where i.workspace_id = g.workspace_id
         and i.deleted_at is null and i.archived_at is null
         and g.related_entity_type = 'investment'
         and i.id = g.related_entity_id)
    when 'debt_payoff' then (
      select coalesce(sum(l.paid_amount), 0)
        from liabilities l
       where l.workspace_id = g.workspace_id
         and l.deleted_at is null
         and (g.related_entity_type is distinct from 'liability'
              or l.id = g.related_entity_id))
    when 'gross_worth' then
      (select n.gross_worth from net_worth_current(g.workspace_id) n)
    when 'liability_reduction' then
      (select n.total_liabilities from net_worth_current(g.workspace_id) n)
    when 'net_worth' then
      (select n.net_worth from net_worth_current(g.workspace_id) n)
    when 'project' then app.goal_project_value(g)
    when 'custom' then coalesce(g.current_value_override, g.initial_value)
  end::numeric(14,2);
$$;

-- ── Row Level Security ───────────────────────────────────────────────────

alter table business_projects enable row level security;
alter table project_stages enable row level security;
alter table project_cost_categories enable row level security;
alter table project_documents enable row level security;
alter table project_members enable row level security;

create policy projects_select on business_projects for select
  using (app.is_member(workspace_id) and deleted_at is null);
create policy projects_insert on business_projects for insert
  with check (app.has_permission(workspace_id, 'edit_projects'));
create policy projects_update on business_projects for update
  using (app.has_permission(workspace_id, 'edit_projects'))
  with check (app.has_permission(workspace_id, 'edit_projects')
              and deleted_at is null);

create policy stages_select on project_stages for select
  using (app.is_member(workspace_id));
create policy stages_write on project_stages for all
  using (app.has_permission(workspace_id, 'edit_projects'))
  with check (app.has_permission(workspace_id, 'edit_projects'));

create policy cost_categories_select on project_cost_categories for select
  using (app.is_member(workspace_id));
create policy cost_categories_write on project_cost_categories for all
  using (app.has_permission(workspace_id, 'edit_projects'))
  with check (app.has_permission(workspace_id, 'edit_projects'));

create policy documents_select on project_documents for select
  using (app.is_member(workspace_id));
create policy documents_write on project_documents for all
  using (app.has_permission(workspace_id, 'edit_projects'))
  with check (app.has_permission(workspace_id, 'edit_projects'));

create policy project_members_select on project_members for select
  using (app.is_member(workspace_id));
create policy project_members_write on project_members for all
  using (app.has_permission(workspace_id, 'edit_projects'))
  with check (app.has_permission(workspace_id, 'edit_projects'));

revoke all on business_projects, project_stages, project_cost_categories,
  project_documents, project_members, project_transactions from anon;
grant select, insert, update on business_projects to authenticated;
grant select, insert, update, delete on project_stages to authenticated;
grant select, insert, update, delete on project_cost_categories to authenticated;
grant select, insert, update, delete on project_documents to authenticated;
grant select, insert, update, delete on project_members to authenticated;
grant select on project_transactions to authenticated;
