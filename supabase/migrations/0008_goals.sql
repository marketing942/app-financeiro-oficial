-- Phase 8: central goal engine. One goal, many derived milestones — status
-- and pace are ALWAYS computed by goal_progress() from live aggregates
-- (never stored), so there is a single source of truth. Manual override of
-- the current value is allowed only for type 'custom'.

create type goal_type as enum (
  'income', 'expense_limit', 'contribution', 'reserve', 'investment',
  'project', 'debt_payoff', 'acquisition', 'gross_worth',
  'liability_reduction', 'net_worth', 'custom');

create type goal_status as enum (
  'not_started', 'ahead', 'on_track', 'attention',
  'behind', 'completed', 'expired');

create table goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  type goal_type not null,
  related_entity_type text check (related_entity_type in
    ('category', 'account', 'investment', 'liability', 'asset', 'project')),
  related_entity_id uuid,
  initial_value numeric(14,2) not null default 0,
  target_value numeric(14,2) not null check (target_value >= 0),
  current_value_override numeric(14,2),
  tolerance_percent numeric(5,2) check (tolerance_percent >= 0),
  start_date date not null default current_date,
  end_date date not null,
  priority int not null default 0,
  note text,
  archived_at timestamptz,
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date > start_date),
  check (related_entity_id is null or related_entity_type is not null),
  check (current_value_override is null or type = 'custom')
);

create index goals_workspace_idx on goals (workspace_id)
  where archived_at is null;

create trigger set_updated_at before update on goals
  for each row execute function app.set_updated_at();
create trigger prevent_workspace_change before update on goals
  for each row execute function app.prevent_workspace_change();

-- ── Current value per type (CALCULATIONS.md §7) ──────────────────────────
-- income/expense_limit/contribution somam o REALIZADO do período (fluxo);
-- reserve/investment/debt_payoff/patrimônio leem o agregado atual (estoque);
-- project ativa na Fase 9 (project_financials); custom usa o override.

create function app.goal_current_value(g goals)
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
    when 'project' then 0 -- ativa na Fase 9 (project_financials)
    when 'custom' then coalesce(g.current_value_override, g.initial_value)
  end::numeric(14,2);
$$;

-- ── Motor de ritmo ───────────────────────────────────────────────────────
-- Meses em índice de calendário: meses_totais = índice(end) − índice(start),
-- mínimo 1; transcorridos limitados a [0, meses_totais]. Direção minimize
-- (expense_limit, liability_reduction) inverte a diferença de ritmo:
-- estar ABAIXO do esperado é bom. Tolerância: meta → workspace → 5%.

create function public.goal_progress(
  p_workspace uuid,
  p_today date default current_date
)
returns table (
  goal_id uuid,
  name text,
  type goal_type,
  direction text,
  related_entity_type text,
  related_entity_id uuid,
  initial_value numeric(14,2),
  target_value numeric(14,2),
  current_value numeric(14,2),
  expected_value numeric(14,2),
  pace_diff numeric(14,2),
  monthly_need_initial numeric(14,2),
  monthly_need_updated numeric(14,2),
  progress_percent numeric(7,2),
  months_total int,
  months_elapsed int,
  months_remaining int,
  start_date date,
  end_date date,
  priority int,
  note text,
  status goal_status
)
language sql stable
as $$
  with base as (
    select g.*,
           app.goal_current_value(g) as curr,
           case when g.type in ('expense_limit', 'liability_reduction')
                then 'minimize' else 'maximize' end as dir,
           coalesce(
             g.tolerance_percent,
             nullif((select ws.default_tolerance from workspace_settings ws
                      where ws.workspace_id = g.workspace_id), 0),
             5)::numeric as tol_pct,
           greatest(1,
             (extract(year from g.end_date) * 12
              + extract(month from g.end_date))
             - (extract(year from g.start_date) * 12
                + extract(month from g.start_date)))::int as m_total
      from goals g
     where g.workspace_id = p_workspace
       and g.archived_at is null
       and app.is_member(p_workspace)
  ),
  pace as (
    select b.*,
           least(b.m_total, greatest(0,
             ((extract(year from p_today) * 12 + extract(month from p_today))
              - (extract(year from b.start_date) * 12
                 + extract(month from b.start_date)))::int)) as m_elapsed
      from base b
  ),
  calc as (
    select p.*,
           (p.m_total - p.m_elapsed) as m_remaining,
           round((p.target_value - p.initial_value) / p.m_total, 2)
             as need_initial,
           round(p.initial_value
             + (p.target_value - p.initial_value) * p.m_elapsed / p.m_total,
             2) as expected
      from pace p
  ),
  scored as (
    select c.*,
           case when c.dir = 'minimize'
                then c.expected - c.curr
                else c.curr - c.expected end as diff,
           greatest(0, case when c.dir = 'minimize'
                            then c.curr - c.target_value
                            else c.target_value - c.curr end) as remaining_abs,
           round(abs(c.expected) * c.tol_pct / 100, 2) as tol_value
      from calc c
  )
  select s.id, s.name, s.type, s.dir,
         s.related_entity_type, s.related_entity_id,
         s.initial_value, s.target_value,
         s.curr,
         s.expected,
         s.diff::numeric(14,2),
         s.need_initial,
         case when s.m_remaining > 0
              then round(s.remaining_abs / s.m_remaining, 2)
              else s.remaining_abs end,
         case when s.target_value <> 0
              then round(s.curr / s.target_value * 100, 2)
              else null end,
         s.m_total, s.m_elapsed, s.m_remaining,
         s.start_date, s.end_date, s.priority, s.note,
         case
           when p_today < s.start_date then 'not_started'
           -- Metas de estoque concluem ao atingir o alvo; limite de despesa
           -- (fluxo) só conclui com o período encerrado dentro do limite.
           when s.dir = 'maximize' and s.curr >= s.target_value
             then 'completed'
           when s.type = 'liability_reduction' and s.curr <= s.target_value
             then 'completed'
           when s.type = 'expense_limit' and p_today > s.end_date
                and s.curr <= s.target_value
             then 'completed'
           when p_today > s.end_date then 'expired'
           -- Regra do 100%: exatamente no limite = atingido (atenção);
           -- somente ACIMA = ultrapassado (atrasada).
           when s.type = 'expense_limit' and s.curr > s.target_value
             then 'behind'
           when s.type = 'expense_limit' and s.curr = s.target_value
             then 'attention'
           when s.diff > s.tol_value then 'ahead'
           when abs(s.diff) <= s.tol_value then 'on_track'
           when abs(s.diff) <= abs(s.need_initial) then 'attention'
           else 'behind'
         end::goal_status
    from scored s
   order by s.priority desc, s.end_date, s.name;
$$;

grant execute on function public.goal_progress(uuid, date) to authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────

alter table goals enable row level security;

create policy goals_select on goals for select
  using (app.is_member(workspace_id));
create policy goals_insert on goals for insert
  with check (app.has_permission(workspace_id, 'edit_goals'));
create policy goals_update on goals for update
  using (app.has_permission(workspace_id, 'edit_goals'))
  with check (app.has_permission(workspace_id, 'edit_goals'));

revoke all on goals from anon;
grant select, insert, update on goals to authenticated;
