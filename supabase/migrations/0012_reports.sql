-- Phase 12: reports. One extra aggregate: the month-by-month series used
-- by the evolution chart and the CSV export. Reports never recompute in
-- the frontend — same sources as the Dashboard.

create function public.monthly_series(
  p_workspace uuid,
  p_from date,
  p_to date
)
returns table (
  month date,
  net_income_actual numeric(14,2),
  expenses_actual numeric(14,2),
  financing_actual numeric(14,2),
  contributions_actual numeric(14,2),
  debt_payments_actual numeric(14,2),
  free_cash numeric(14,2)
)
language sql stable
as $$
  select t.competence_month,
         coalesce(sum(coalesce(t.net_amount_actual, t.actual_amount)) filter (
           where t.nature = 'income'), 0)::numeric(14,2) as inc,
         coalesce(sum(t.actual_amount) filter (
           where t.nature = 'consumer_expense'), 0)::numeric(14,2) as exp,
         coalesce(sum(t.actual_amount) filter (
           where t.nature = 'consumer_financing'), 0)::numeric(14,2) as fin,
         coalesce(sum(t.actual_amount) filter (
           where t.nature = 'investment_contribution'), 0)::numeric(14,2) as contrib,
         coalesce(sum(t.actual_amount) filter (
           where t.nature = 'debt_payment'), 0)::numeric(14,2) as debt,
         (coalesce(sum(coalesce(t.net_amount_actual, t.actual_amount)) filter (
            where t.nature = 'income'), 0)
          - coalesce(sum(t.actual_amount) filter (
              where t.nature in ('consumer_expense', 'consumer_financing',
                                 'investment_contribution', 'debt_payment')), 0)
         )::numeric(14,2)
    from transactions t
   where t.workspace_id = p_workspace
     and app.is_member(t.workspace_id)
     and t.deleted_at is null
     and t.project_id is null
     and t.status in ('realized', 'partially_realized')
     and t.competence_month between date_trunc('month', p_from)::date
                                and date_trunc('month', p_to)::date
   group by t.competence_month
   order by t.competence_month;
$$;

grant execute on function public.monthly_series(uuid, date, date) to authenticated;
