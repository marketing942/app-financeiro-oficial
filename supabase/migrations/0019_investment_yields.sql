-- Phase 19: rendimentos de investimento.
-- O saldo crescia só com aportes; o rendimento (juros, valorização, dividendos
-- reinvestidos) não tinha como ser lançado. Cada rendimento é um registro
-- mensal (pode ser negativo = prejuízo) que entra no saldo do investimento e é
-- agregável por período (card "Rendimento" no dashboard). Não é receita de
-- caixa: fica isolado das agregações de fluxo e da regra 50/20/30.

create table investment_yields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  investment_id uuid not null references investments (id) on delete cascade,
  competence_month date not null,
  amount numeric(14,2) not null,
  note text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (competence_month = date_trunc('month', competence_month)::date)
);

create index investment_yields_investment_idx
  on investment_yields (investment_id) where deleted_at is null;
create index investment_yields_ws_month_idx
  on investment_yields (workspace_id, competence_month) where deleted_at is null;

create trigger set_updated_at before update on investment_yields
  for each row execute function app.set_updated_at();
create trigger prevent_workspace_change before update on investment_yields
  for each row execute function app.prevent_workspace_change();

-- Saldo do investimento passa a incluir os rendimentos lançados.
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
         ), 0) + i.balance_adjustment + coalesce((
           select sum(y.amount)
             from investment_yields y
            where y.investment_id = i.id
              and y.deleted_at is null
         ), 0)
   where i.id = p_investment;
$$;

-- Recomputa o saldo quando um rendimento é lançado, editado ou removido.
create function app.sync_investment_yield()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.investment_id is not null then
    perform app.recompute_investment_balance(new.investment_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.investment_id is not null then
    perform app.recompute_investment_balance(old.investment_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger sync_investment_yield
  after insert or update or delete on investment_yields
  for each row execute function app.sync_investment_yield();

-- Total de rendimento de um período (para o dashboard).
create function public.investment_yield_total(
  p_workspace uuid, p_from date, p_to date
)
returns numeric(14,2)
language sql stable
as $$
  select coalesce(sum(y.amount), 0)::numeric(14,2)
    from investment_yields y
   where y.workspace_id = p_workspace
     and y.deleted_at is null
     and app.is_member(p_workspace)
     and y.competence_month
           between date_trunc('month', p_from)::date
               and date_trunc('month', p_to)::date;
$$;

grant execute on function public.investment_yield_total(uuid, date, date)
  to authenticated;

-- RLS: membros leem; escrever exige edit_investments. Exclusão é lógica.
alter table investment_yields enable row level security;

create policy yields_select on investment_yields for select
  using (app.is_member(workspace_id) and deleted_at is null);
create policy yields_insert on investment_yields for insert
  with check (app.has_permission(workspace_id, 'edit_investments')
              and created_by = auth.uid());
create policy yields_update on investment_yields for update
  using (app.has_permission(workspace_id, 'edit_investments'))
  with check (app.has_permission(workspace_id, 'edit_investments'));

revoke all on investment_yields from anon;
grant select, insert, update on investment_yields to authenticated;

-- Exclusão lógica via função (o UPDATE direto de deleted_at é barrado pela
-- política de SELECT, que exige deleted_at nulo).
create function public.soft_delete_yield(p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  y investment_yields%rowtype;
begin
  select * into y from investment_yields
   where id = p_id and deleted_at is null
   for update;
  if not found then
    return false;
  end if;
  if not app.has_permission(y.workspace_id, 'edit_investments') then
    raise exception 'not_authorized';
  end if;

  update investment_yields
     set deleted_at = now(), updated_by = auth.uid()
   where id = p_id;

  perform app.log_audit(y.workspace_id, 'investment.yield_deleted',
    'investment_yield', p_id, 'Rendimento excluído');

  return true;
end;
$$;

grant execute on function public.soft_delete_yield(uuid) to authenticated;
