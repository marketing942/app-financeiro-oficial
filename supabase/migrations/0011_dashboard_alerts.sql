-- Phase 11: dashboard aggregates and the alert engine. Alerts are computed
-- idempotently by recompute_alerts() from the same aggregates the pages
-- use. The 100% rule is enforced here: exactly 100% = "atingido"
-- (attention), only ABOVE 100% = "ultrapassado" (critical).

create type alert_severity as enum ('info', 'attention', 'critical', 'success');

create table category_limits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  subcategory_id uuid references subcategories (id) on delete cascade,
  monthly_limit numeric(14,2) check (monthly_limit > 0),
  annual_limit numeric(14,2) check (annual_limit > 0),
  tolerance_percent numeric(5,2) not null default 0 check (tolerance_percent >= 0),
  valid_from date not null default current_date,
  valid_until date,
  active boolean not null default true,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (workspace_id, category_id, subcategory_id, valid_from)
);

create index category_limits_ws_idx on category_limits (workspace_id)
  where active;

create table alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  rule_key text not null,
  severity alert_severity not null,
  title text not null,
  body text,
  amount numeric(14,2),
  reference_date date not null,
  action_label text,
  action_url text,
  entity_type text,
  entity_id uuid,
  seen_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct (workspace_id, rule_key, entity_id, reference_date)
);

create index alerts_ws_open_idx on alerts (workspace_id, created_at desc)
  where resolved_at is null;

-- ── Resumo do Dashboard (CALCULATIONS §8) ────────────────────────────────

create function public.dashboard_summary(
  p_workspace uuid,
  p_from date,
  p_to date
)
returns table (
  net_income_planned numeric(14,2),
  net_income_actual numeric(14,2),
  expenses_planned numeric(14,2),
  expenses_actual numeric(14,2),
  financing_actual numeric(14,2),
  contributions_actual numeric(14,2),
  debt_payments_actual numeric(14,2),
  outflows_planned numeric(14,2),
  outflows_actual numeric(14,2),
  balance_planned numeric(14,2),
  balance_actual numeric(14,2),
  operating_balance numeric(14,2),
  free_cash numeric(14,2)
)
language sql stable
as $$
  with base as (
    select
      coalesce(sum(coalesce(t.net_amount_planned, t.planned_amount)) filter (
        where t.nature = 'income'
          and t.status not in ('canceled', 'no_demand')), 0)::numeric(14,2) as inc_p,
      coalesce(sum(coalesce(t.net_amount_actual, t.actual_amount)) filter (
        where t.nature = 'income'
          and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as inc_a,
      coalesce(sum(t.planned_amount) filter (
        where t.nature = 'consumer_expense'
          and t.status not in ('canceled', 'no_demand')), 0)::numeric(14,2) as exp_p,
      coalesce(sum(t.actual_amount) filter (
        where t.nature = 'consumer_expense'
          and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as exp_a,
      coalesce(sum(t.planned_amount) filter (
        where t.nature in ('consumer_financing', 'investment_contribution', 'debt_payment')
          and t.status not in ('canceled', 'no_demand')), 0)::numeric(14,2) as other_out_p,
      coalesce(sum(t.actual_amount) filter (
        where t.nature = 'consumer_financing'
          and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as fin_a,
      coalesce(sum(t.actual_amount) filter (
        where t.nature = 'investment_contribution'
          and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as contrib_a,
      coalesce(sum(t.actual_amount) filter (
        where t.nature = 'debt_payment'
          and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as debt_a
    from transactions t
    where t.workspace_id = p_workspace
      and app.is_member(t.workspace_id)
      and t.deleted_at is null
      and t.project_id is null -- projetos nunca nos agregados pessoais
      and t.competence_month between date_trunc('month', p_from)::date
                                 and date_trunc('month', p_to)::date
  )
  select
    b.inc_p, b.inc_a,
    b.exp_p, b.exp_a,
    b.fin_a, b.contrib_a, b.debt_a,
    (b.exp_p + b.other_out_p)::numeric(14,2),
    (b.exp_a + b.fin_a + b.contrib_a + b.debt_a)::numeric(14,2),
    (b.inc_p - b.exp_p - b.other_out_p)::numeric(14,2),
    (b.inc_a - b.exp_a - b.fin_a - b.contrib_a - b.debt_a)::numeric(14,2),
    (b.inc_a - b.exp_a)::numeric(14,2),
    (b.inc_a - b.exp_a - b.fin_a - b.contrib_a - b.debt_a)::numeric(14,2)
  from base b;
$$;

grant execute on function public.dashboard_summary(uuid, date, date) to authenticated;

-- ── Motor de alertas (idempotente) ───────────────────────────────────────

create function public.recompute_alerts(
  p_workspace uuid,
  p_from date default date_trunc('month', current_date)::date,
  p_to date default current_date
)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  month_ref date := date_trunc('month', p_from)::date;
  total int;
  s record;
  r record;
  reserve record;
begin
  if not app.is_member(p_workspace) then
    raise exception 'not_authorized';
  end if;

  drop table if exists _new_alerts;
  create temp table _new_alerts (
    rule_key text,
    severity alert_severity,
    title text,
    body text,
    amount numeric(14,2),
    reference_date date,
    action_url text,
    entity_type text,
    entity_id uuid
  ) on commit drop;

  select * into s from dashboard_summary(p_workspace, p_from, p_to);

  -- Saídas acima da receita (caixa livre negativo).
  if s.free_cash < 0 then
    insert into _new_alerts values ('negative_free_cash', 'critical',
      'Saídas acima da receita',
      'O caixa livre do período está negativo: as saídas realizadas superam a receita líquida.',
      s.free_cash, month_ref, '/relatorios', null, null);
  end if;

  -- Receita líquida abaixo do previsto (avaliada após o fim do período).
  if current_date > p_to and s.net_income_actual < s.net_income_planned then
    insert into _new_alerts values ('net_income_below_planned', 'attention',
      'Receita abaixo do previsto',
      'A receita líquida realizada ficou abaixo da prevista no período.',
      s.net_income_planned - s.net_income_actual, month_ref,
      '/receitas', null, null);
  end if;

  -- Regra 50/20/30 — igualdade exata está DENTRO; só ACIMA dispara.
  select * into r from rule_50_20_30(p_workspace, p_from, p_to);
  if r.net_income > 0 then
    if r.pct_expenses > 50 then
      insert into _new_alerts values ('expenses_above_50', 'critical',
        'Despesas acima de 50% da renda',
        format('Despesas de consumo em %s%% da renda líquida (limite: 50%%).', r.pct_expenses),
        r.expenses, month_ref, '/despesas', null, null);
    end if;
    if r.pct_financing > 20 then
      insert into _new_alerts values ('financing_above_20', 'critical',
        'Financiamentos acima de 20% da renda',
        format('Financiamentos e dívidas de consumo próprio em %s%% (limite: 20%%).', r.pct_financing),
        r.financing, month_ref, '/financiamentos', null, null);
    end if;
    if r.pct_investments < 30 then
      insert into _new_alerts values ('investments_below_30', 'attention',
        'Aportes abaixo de 30% da renda',
        format('Aportes em %s%% da renda líquida (mínimo: 30%%).', r.pct_investments),
        r.investments, month_ref, '/investimentos', null, null);
    end if;
  end if;

  -- Limites por categoria: 80% (atenção), exatamente 100% = atingido,
  -- SOMENTE acima de 100% = ultrapassado.
  insert into _new_alerts
  select case
           when spend.actual_total > cl.monthly_limit then 'category_limit_exceeded'
           when spend.actual_total = cl.monthly_limit then 'category_limit_reached'
           else 'category_limit_80'
         end,
         case
           when spend.actual_total > cl.monthly_limit then 'critical'::alert_severity
           else 'attention'::alert_severity
         end,
         case
           when spend.actual_total > cl.monthly_limit
             then format('Limite de "%s" ultrapassado', spend.category_name)
           when spend.actual_total = cl.monthly_limit
             then format('Limite de "%s" atingido', spend.category_name)
           else format('Categoria "%s" em %s%% do limite', spend.category_name,
                       round(spend.actual_total / cl.monthly_limit * 100))
         end,
         format('Gasto de %s de um limite mensal de %s.',
                spend.actual_total, cl.monthly_limit),
         spend.actual_total, month_ref, '/despesas', 'category', cl.category_id
    from category_spend(p_workspace, p_from, p_to) spend
    join category_limits cl
      on cl.workspace_id = p_workspace
     and cl.category_id = spend.category_id
     and cl.active
     and cl.monthly_limit is not null
     and cl.valid_from <= p_to
     and (cl.valid_until is null or cl.valid_until >= p_from)
   where spend.actual_total >= cl.monthly_limit * 0.8;

  -- Vencimento próximo (7 dias) e atraso, por transação.
  insert into _new_alerts
  select case when up.status = 'overdue' or up.due_date < current_date
              then 'payment_overdue' else 'payment_due_soon' end,
         case when up.status = 'overdue' or up.due_date < current_date
              then 'critical'::alert_severity else 'info'::alert_severity end,
         case when up.status = 'overdue' or up.due_date < current_date
              then format('Em atraso: %s', up.description)
              else format('Vence em breve: %s', up.description) end,
         format('Vencimento em %s.', to_char(up.due_date, 'DD/MM/YYYY')),
         up.amount, up.due_date, '/despesas', 'transaction', up.transaction_id
    from upcoming_payments(p_workspace, 7) up;

  -- Aporte planejado vencido e não realizado.
  insert into _new_alerts
  select 'contribution_missed', 'attention',
         format('Aporte não realizado: %s', t.description),
         format('Aporte planejado para %s ainda não foi realizado.',
                to_char(t.due_date, 'DD/MM/YYYY')),
         t.planned_amount, t.due_date, '/investimentos', 'transaction', t.id
    from transactions t
   where t.workspace_id = p_workspace
     and t.deleted_at is null
     and t.nature = 'investment_contribution'
     and t.status in ('planned', 'pending', 'overdue')
     and t.due_date < current_date;

  -- Reserva de emergência abaixo do alvo × limiar de alerta.
  select * into reserve from emergency_reserve_summary(p_workspace);
  if reserve.effective_target is not null and reserve.effective_target > 0 then
    if reserve.current_balance < reserve.effective_target
       * coalesce((select ws.alert_threshold from workspace_settings ws
                    where ws.workspace_id = p_workspace), 80) / 100 then
      insert into _new_alerts values ('reserve_below_target', 'attention',
        'Reserva de emergência abaixo do alvo',
        format('Saldo de %s para um alvo de %s.',
               reserve.current_balance, reserve.effective_target),
        reserve.current_balance, month_ref, '/investimentos', null, null);
    end if;
  end if;

  -- Projetos: acima do orçamento (só ACIMA) e margem negativa.
  insert into _new_alerts
  select 'project_over_budget', 'critical',
         format('Projeto "%s" acima do orçamento', bp.name),
         format('Custo realizado de %s para um orçamento de %s.',
                pf.actual_cost, bp.budget),
         pf.actual_cost, month_ref, '/projetos', 'business_project', bp.id
    from project_financials(p_workspace) pf
    join business_projects bp on bp.id = pf.project_id
   where bp.budget is not null
     and pf.actual_cost > bp.budget;

  insert into _new_alerts
  select 'project_negative_margin', 'critical',
         format('Projeto "%s" com resultado negativo', bp.name),
         format('Resultado líquido de %s.', pf.net_result),
         pf.net_result, month_ref, '/projetos', 'business_project', bp.id
    from project_financials(p_workspace) pf
    join business_projects bp on bp.id = pf.project_id
   where pf.net_result < 0
     and pf.revenue_actual > 0;

  -- Metas: atrasadas (atenção), vencidas (crítico), concluídas (sucesso).
  insert into _new_alerts
  select case gp.status
           when 'behind' then 'goal_behind'
           when 'expired' then 'goal_expired'
           else 'goal_completed' end,
         case gp.status
           when 'behind' then 'attention'::alert_severity
           when 'expired' then 'critical'::alert_severity
           else 'success'::alert_severity end,
         case gp.status
           when 'behind' then format('Meta atrasada: %s', gp.name)
           when 'expired' then format('Meta vencida: %s', gp.name)
           else format('Meta concluída: %s 🎉', gp.name) end,
         format('Atual: %s · Esperado: %s · Alvo: %s.',
                gp.current_value, gp.expected_value, gp.target_value),
         gp.current_value, month_ref, '/planejamento', 'goal', gp.goal_id
    from goal_progress(p_workspace) gp
   where gp.status in ('behind', 'expired', 'completed');

  -- Contas a vencer sem instrução de pagamento cadastrada.
  insert into _new_alerts
  select 'payment_data_missing', 'info',
         format('Sem dados de pagamento: %s', t.description),
         'Conta próxima do vencimento sem instrução de pagamento cadastrada.',
         t.planned_amount, t.due_date, '/despesas', 'transaction', t.id
    from transactions t
   where t.workspace_id = p_workspace
     and t.deleted_at is null
     and t.nature in ('consumer_expense', 'consumer_financing', 'debt_payment')
     and t.status in ('planned', 'pending')
     and t.payment_instruction_id is null
     and t.due_date between current_date and current_date + 7;

  -- Upsert idempotente (preserva seen_at) + resolve o que sumiu.
  insert into alerts (workspace_id, rule_key, severity, title, body, amount,
    reference_date, action_url, entity_type, entity_id)
  select p_workspace, n.rule_key, n.severity, n.title, n.body, n.amount,
         n.reference_date, n.action_url, n.entity_type, n.entity_id
    from _new_alerts n
  on conflict (workspace_id, rule_key, entity_id, reference_date)
  do update set severity = excluded.severity,
                title = excluded.title,
                body = excluded.body,
                amount = excluded.amount,
                resolved_at = null;

  update alerts a
     set resolved_at = now()
   where a.workspace_id = p_workspace
     and a.resolved_at is null
     and a.rule_key <> 'nylo_insight'
     and a.reference_date between least(p_from, current_date - 30)
                               and greatest(p_to, current_date + 30)
     and not exists (
       select 1 from _new_alerts n
        where n.rule_key = a.rule_key
          and n.entity_id is not distinct from a.entity_id
          and n.reference_date = a.reference_date);

  select count(*)::int into total from _new_alerts;
  return total;
end;
$$;

grant execute on function public.recompute_alerts(uuid, date, date) to authenticated;

create function public.mark_alert_seen(p_alert uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  a alerts%rowtype;
begin
  select * into a from alerts where id = p_alert;
  if not found or not app.is_member(a.workspace_id) then
    return false;
  end if;
  update alerts set seen_at = coalesce(seen_at, now()) where id = p_alert;
  return true;
end;
$$;

grant execute on function public.mark_alert_seen(uuid) to authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────

alter table category_limits enable row level security;
alter table alerts enable row level security;

create policy limits_select on category_limits for select
  using (app.is_member(workspace_id));
create policy limits_write on category_limits for all
  using (app.is_owner(workspace_id))
  with check (app.is_owner(workspace_id));

-- Alertas: leitura para membros; escrita apenas via funções.
create policy alerts_select on alerts for select
  using (app.is_member(workspace_id));

revoke all on category_limits, alerts from anon;
grant select, insert, update, delete on category_limits to authenticated;
grant select on alerts to authenticated;
