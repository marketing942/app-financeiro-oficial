-- Phase 7: assets, valuation history and net worth. Current values always
-- come from the latest valuation event (never overwriting purchase value);
-- snapshots exist ONLY for history and are never rebuilt from current data.

create type asset_status as enum ('active', 'sold', 'written_off', 'archived');

create type asset_type as enum (
  'property', 'land', 'vehicle', 'company', 'equity_stake', 'financial',
  'equipment', 'construction', 'capitalizable_project', 'other');

create type asset_event_type as enum (
  'acquisition', 'appraisal', 'appreciation', 'depreciation',
  'improvement', 'contribution', 'amortization', 'sale', 'write_off',
  'adjustment');

create table assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  type asset_type not null,
  category text,
  purchase_value numeric(14,2) not null check (purchase_value >= 0),
  purchase_date date,
  current_value numeric(14,2) not null check (current_value >= 0),
  valuation_date date,
  valuation_source text,
  ownership_percent numeric(5,2) not null default 100
    check (ownership_percent > 0 and ownership_percent <= 100),
  liability_id uuid references liabilities (id) on delete set null,
  project_id uuid,
  status asset_status not null default 'active',
  sale_value numeric(14,2) check (sale_value >= 0),
  sale_date date,
  sale_account_id uuid references financial_accounts (id),
  sale_costs numeric(14,2) check (sale_costs >= 0),
  note text,
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index assets_workspace_idx on assets (workspace_id) where deleted_at is null;

create table asset_valuations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  asset_id uuid not null references assets (id) on delete cascade,
  event_type asset_event_type not null,
  value numeric(14,2) check (value >= 0),
  event_date date not null default current_date,
  source text,
  note text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index asset_valuations_asset_idx
  on asset_valuations (asset_id, event_date desc);

create trigger set_updated_at before update on assets
  for each row execute function app.set_updated_at();
create trigger prevent_workspace_change before update on assets
  for each row execute function app.prevent_workspace_change();
create trigger prevent_workspace_change before update on asset_valuations
  for each row execute function app.prevent_workspace_change();

alter table transactions
  add constraint transactions_asset_fk
  foreign key (asset_id) references assets (id) on delete set null;
alter table liabilities
  add constraint liabilities_asset_fk
  foreign key (asset_id) references assets (id) on delete set null;
alter table investments
  add constraint investments_asset_fk
  foreign key (asset_id) references assets (id) on delete set null;

-- Novo ativo nasce com o evento de aquisição no histórico.
create function app.handle_new_asset()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into asset_valuations (workspace_id, asset_id, event_type, value,
                                event_date, source, created_by)
  values (new.workspace_id, new.id, 'acquisition', new.purchase_value,
          coalesce(new.purchase_date, current_date), 'purchase', new.created_by);
  return new;
end;
$$;

create trigger on_asset_created
  after insert on assets
  for each row execute function app.handle_new_asset();

-- Avaliações atualizam o valor atual do ativo (evento mais recente vence).
-- O valor de compra NUNCA é substituído — a variação é sempre calculável.
create function app.apply_asset_valuation()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.event_type in ('acquisition', 'appraisal', 'appreciation',
                        'depreciation', 'improvement', 'adjustment')
     and new.value is not null then
    update assets a
       set current_value = new.value,
           valuation_date = new.event_date,
           valuation_source = new.source
     where a.id = new.asset_id
       and (a.valuation_date is null or new.event_date >= a.valuation_date);
  end if;
  return new;
end;
$$;

create trigger apply_asset_valuation
  after insert on asset_valuations
  for each row execute function app.apply_asset_valuation();

-- ── Venda de ativo (preserva todo o histórico) ───────────────────────────

create function public.sell_asset(
  p_asset uuid,
  p_sale_value numeric(14,2),
  p_sale_date date,
  p_account uuid default null,
  p_sale_costs numeric(14,2) default 0
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  a assets%rowtype;
  net_proceeds numeric(14,2);
  tx_id uuid;
begin
  select * into a from assets
   where id = p_asset and deleted_at is null
   for update;
  if not found then
    raise exception 'asset_not_found';
  end if;
  if not app.has_permission(a.workspace_id, 'edit_assets') then
    raise exception 'not_authorized';
  end if;
  if a.status = 'sold' then
    raise exception 'asset_already_sold';
  end if;

  net_proceeds := p_sale_value - coalesce(p_sale_costs, 0);

  update assets
     set status = 'sold',
         sale_value = p_sale_value,
         sale_date = p_sale_date,
         sale_account_id = p_account,
         sale_costs = coalesce(p_sale_costs, 0),
         updated_by = auth.uid()
   where id = p_asset;

  insert into asset_valuations (workspace_id, asset_id, event_type, value,
                                event_date, source, created_by)
  values (a.workspace_id, p_asset, 'sale', p_sale_value, p_sale_date,
          'sale', auth.uid());

  -- Entrada de caixa (impacto registrado como transação da fonte única).
  insert into transactions (workspace_id, nature, description, account_id,
    asset_id, planned_amount, actual_amount, competence_month, realized_date,
    status, origin, note, created_by)
  values (a.workspace_id, 'asset_sale',
          'Venda — ' || a.name, p_account, p_asset,
          net_proceeds, net_proceeds,
          date_trunc('month', p_sale_date)::date, p_sale_date,
          'realized', 'manual',
          case when coalesce(p_sale_costs, 0) > 0
               then 'Custos da venda: ' || p_sale_costs else null end,
          auth.uid())
  returning id into tx_id;

  perform app.log_audit(a.workspace_id, 'asset.sold', 'asset', p_asset,
    'Ativo "' || a.name || '" vendido por ' || p_sale_value);

  return tx_id;
end;
$$;

grant execute on function public.sell_asset(uuid, numeric, date, uuid, numeric)
  to authenticated;

-- ── Patrimônio atual (sempre agregado ao vivo, nunca do snapshot) ────────

create function public.net_worth_current(p_workspace uuid)
returns table (
  gross_worth numeric(14,2),
  total_liabilities numeric(14,2),
  net_worth numeric(14,2),
  investments_total numeric(14,2),
  cash_total numeric(14,2)
)
language sql stable
as $$
  with checks as (
    select app.is_member(p_workspace) as ok
  ),
  gross as (
    select coalesce(sum(a.current_value * a.ownership_percent / 100), 0)::numeric(14,2) as v
      from assets a, checks
     where checks.ok
       and a.workspace_id = p_workspace
       and a.status = 'active'
       and a.deleted_at is null
  ),
  debts as (
    select coalesce(sum(l.current_balance), 0)::numeric(14,2) as v
      from liabilities l, checks
     where checks.ok
       and l.workspace_id = p_workspace
       and l.status not in ('settled', 'canceled')
       and l.deleted_at is null
  ),
  inv as (
    select coalesce(sum(i.current_balance), 0)::numeric(14,2) as v
      from investments i, checks
     where checks.ok
       and i.workspace_id = p_workspace
       and i.archived_at is null
       and i.deleted_at is null
  ),
  cash as (
    select coalesce(sum(b.balance), 0)::numeric(14,2) as v
      from account_balances b, checks
     where checks.ok and b.workspace_id = p_workspace
  )
  select gross.v, debts.v, (gross.v - debts.v)::numeric(14,2), inv.v, cash.v
  from gross, debts, inv, cash;
$$;

grant execute on function public.net_worth_current(uuid) to authenticated;

-- ── Snapshots (histórico imutável, upsert idempotente por data) ──────────

create table net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  snapshot_date date not null,
  gross_worth numeric(14,2) not null,
  total_liabilities numeric(14,2) not null,
  net_worth numeric(14,2) not null,
  investments_total numeric(14,2) not null,
  cash_total numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, snapshot_date)
);

create index net_worth_snapshots_ws_idx
  on net_worth_snapshots (workspace_id, snapshot_date desc);

create function public.create_net_worth_snapshot(
  p_workspace uuid,
  p_date date default current_date
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not app.is_member(p_workspace) then
    raise exception 'not_authorized';
  end if;

  insert into net_worth_snapshots (workspace_id, snapshot_date, gross_worth,
    total_liabilities, net_worth, investments_total, cash_total)
  select p_workspace, p_date, n.gross_worth, n.total_liabilities,
         n.net_worth, n.investments_total, n.cash_total
    from net_worth_current(p_workspace) n
  on conflict (workspace_id, snapshot_date) do update
    set gross_worth = excluded.gross_worth,
        total_liabilities = excluded.total_liabilities,
        net_worth = excluded.net_worth,
        investments_total = excluded.investments_total,
        cash_total = excluded.cash_total;
end;
$$;

grant execute on function public.create_net_worth_snapshot(uuid, date) to authenticated;

-- Cron mensal (service_role): snapshot de todos os workspaces.
create function public.create_monthly_snapshots()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  ws record;
  total int := 0;
begin
  for ws in select id from workspaces where deleted_at is null loop
    perform create_net_worth_snapshot(ws.id, current_date);
    total := total + 1;
  end loop;
  return total;
end;
$$;

revoke all on function public.create_monthly_snapshots() from public, anon, authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────

alter table assets enable row level security;
alter table asset_valuations enable row level security;
alter table net_worth_snapshots enable row level security;

-- Ativos: membros leem; criar/editar exige edit_assets. Avaliações
-- (atualizar dados patrimoniais) qualquer membro registra — atribuição
-- padrão do assistente.
create policy assets_select on assets for select
  using (app.is_member(workspace_id) and deleted_at is null);
create policy assets_insert on assets for insert
  with check (app.has_permission(workspace_id, 'edit_assets'));
create policy assets_update on assets for update
  using (app.has_permission(workspace_id, 'edit_assets'))
  with check (app.has_permission(workspace_id, 'edit_assets')
              and deleted_at is null);

create policy valuations_select on asset_valuations for select
  using (app.is_member(workspace_id));
create policy valuations_insert on asset_valuations for insert
  with check (app.is_member(workspace_id));

-- Snapshots: leitura para membros; escrita apenas via funções.
create policy snapshots_select on net_worth_snapshots for select
  using (app.is_member(workspace_id));

revoke all on assets, asset_valuations, net_worth_snapshots from anon;
grant select, insert, update on assets to authenticated;
grant select, insert on asset_valuations to authenticated;
grant select on net_worth_snapshots to authenticated;
