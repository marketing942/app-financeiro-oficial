-- Phase 18: corrige a média essencial/mês da reserva de emergência.
-- Antes: somava apenas os 6 meses ANTERIORES ao atual (excluindo o mês
-- corrente) e dividia por 6 fixo — quem configurava com gastos no mês atual,
-- ou sem 6 meses de histórico, via 0 ou um valor muito baixo.
-- Agora: considera a janela de até 6 meses INCLUINDO o mês atual e divide
-- pelo número de meses que realmente têm despesa essencial (mínimo 1).

create or replace function public.emergency_reserve_summary(p_workspace uuid)
returns table (
  target_months int,
  manual_target numeric(14,2),
  essential_monthly_avg numeric(14,2),
  computed_target numeric(14,2),
  effective_target numeric(14,2),
  current_balance numeric(14,2),
  percent numeric(7,2)
)
language sql stable
as $$
  with settings as (
    select ws.reserve_target_months, ws.reserve_manual_target,
           ws.essential_category_ids
      from workspace_settings ws
     where ws.workspace_id = p_workspace
       and app.is_member(ws.workspace_id)
  ),
  essential_avg as (
    select coalesce(
             sum(t.actual_amount)
               / greatest(count(distinct t.competence_month), 1),
             0
           )::numeric(14,2) as monthly_avg
      from transactions t, settings s
     where t.workspace_id = p_workspace
       and t.nature = 'consumer_expense'
       and t.status in ('realized', 'partially_realized')
       and t.deleted_at is null
       and s.essential_category_ids is not null
       and t.category_id = any (s.essential_category_ids)
       and t.competence_month
             >= (date_trunc('month', current_date) - interval '5 months')::date
       and t.competence_month <= date_trunc('month', current_date)::date
  ),
  reserve as (
    select coalesce(sum(i.current_balance), 0)::numeric(14,2) as balance
      from investments i
     where i.workspace_id = p_workspace
       and i.investment_group = 'emergency_opportunity'
       and i.archived_at is null
       and i.deleted_at is null
  )
  select
    s.reserve_target_months,
    s.reserve_manual_target,
    e.monthly_avg,
    (e.monthly_avg * coalesce(s.reserve_target_months, 0))::numeric(14,2),
    coalesce(
      s.reserve_manual_target,
      (e.monthly_avg * coalesce(s.reserve_target_months, 0))::numeric(14,2)
    ),
    r.balance,
    case
      when coalesce(s.reserve_manual_target,
             e.monthly_avg * coalesce(s.reserve_target_months, 0)) > 0
      then round(r.balance * 100
             / coalesce(s.reserve_manual_target,
                 e.monthly_avg * coalesce(s.reserve_target_months, 0)), 2)
      else null
    end
  from settings s, essential_avg e, reserve r;
$$;
