-- Phase 17: ajuste manual do saldo de investimento.
-- O saldo era estritamente initial_amount + aportes realizados, sem como
-- refletir RESGATES, rendimento ou o valor real atual. Adiciona uma parcela
-- de ajuste persistida (pode ser negativa) que entra no cálculo do saldo, e
-- uma função para "informar o valor atual real" — que deriva o ajuste e faz
-- o saldo colar nesse valor, sem quebrar a soma de aportes futuros.

alter table investments
  add column balance_adjustment numeric(14,2) not null default 0;

-- Recompute agora inclui o ajuste manual.
create or replace function app.recompute_investment_balance(p_investment uuid)
returns void
language sql security definer
set search_path = public
as $$
  update investments i
     set current_balance = i.initial_amount + coalesce((
           select sum(t.actual_amount)
             from transactions t
            where t.investment_id = i.id
              and t.nature = 'investment_contribution'
              and t.status in ('realized', 'partially_realized')
              and t.deleted_at is null
         ), 0) + i.balance_adjustment
   where i.id = p_investment;
$$;

-- Define o valor atual real do investimento (resgate, rendimento, correção).
-- O ajuste absorve a diferença: current = initial + aportes + ajuste.
create function public.set_investment_balance(p_investment uuid, p_value numeric)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  inv investments%rowtype;
begin
  select * into inv from investments
   where id = p_investment and deleted_at is null
   for update;
  if not found then
    return false;
  end if;
  if not app.has_permission(inv.workspace_id, 'edit_investments') then
    raise exception 'not_authorized';
  end if;
  if p_value < 0 then
    raise exception 'negative_value';
  end if;

  update investments
     set balance_adjustment = p_value - current_balance + balance_adjustment,
         current_balance = p_value,
         updated_by = auth.uid()
   where id = p_investment;

  perform app.log_audit(inv.workspace_id, 'investment.balance_adjusted',
    'investment', p_investment,
    'Saldo de "' || inv.name || '" ajustado de '
    || to_char(inv.current_balance, 'FM999999999990.00') || ' para '
    || to_char(p_value, 'FM999999999990.00'));

  return true;
end;
$$;

grant execute on function public.set_investment_balance(uuid, numeric) to authenticated;
