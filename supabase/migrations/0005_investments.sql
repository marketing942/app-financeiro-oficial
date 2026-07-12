-- Phase 5: investments and contributions. A contribution is ONE transaction
-- (nature investment_contribution) linked 1:1 to the investment — cash out
-- and investment balance always move together, never double-counted.

create type investment_group as enum (
  'real_estate', 'long_term', 'emergency_opportunity', 'future_projects');

create table investments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  investment_group investment_group not null,
  subgroup text,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text,
  initial_amount numeric(14,2) not null default 0 check (initial_amount >= 0),
  current_balance numeric(14,2) not null default 0,
  target_amount numeric(14,2) check (target_amount >= 0),
  start_date date,
  end_date date,
  account_id uuid references financial_accounts (id),
  asset_id uuid,
  expected_return_note text,
  note text,
  archived_at timestamptz,
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index investments_workspace_idx
  on investments (workspace_id) where deleted_at is null;

create table investment_contributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  investment_id uuid not null references investments (id) on delete cascade,
  transaction_id uuid not null unique references transactions (id) on delete cascade,
  note text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index investment_contributions_investment_idx
  on investment_contributions (investment_id);

create trigger set_updated_at before update on investments
  for each row execute function app.set_updated_at();
create trigger prevent_workspace_change before update on investments
  for each row execute function app.prevent_workspace_change();
create trigger prevent_workspace_change before update on investment_contributions
  for each row execute function app.prevent_workspace_change();

-- transactions.investment_id agora tem FK real; séries também podem gerar
-- aportes recorrentes.
alter table transactions
  add constraint transactions_investment_fk
  foreign key (investment_id) references investments (id) on delete set null;
alter table transaction_series
  add column investment_id uuid references investments (id) on delete set null;

-- Saldo do investimento: recomputado (idempotente) a partir dos aportes
-- realizados — nunca duplicado, nunca calculado no frontend.
create function app.recompute_investment_balance(p_investment uuid)
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
         ), 0)
   where i.id = p_investment;
$$;

create function app.sync_investment_balance()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.investment_id is not null then
    perform app.recompute_investment_balance(new.investment_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.investment_id is not null
     and (tg_op = 'DELETE' or old.investment_id is distinct from new.investment_id) then
    perform app.recompute_investment_balance(old.investment_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger sync_investment_balance
  after insert or update or delete on transactions
  for each row
  execute function app.sync_investment_balance();

-- generate_series_transactions agora propaga investment_id.
create or replace function public.generate_series_transactions(p_series_id uuid, p_until date)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  s transaction_series%rowtype;
  occurrence_date date;
  n int := 1;
  created int := 0;
  amount numeric(14,2);
  base numeric(14,2);
  remainder numeric(14,2);
begin
  select * into s from transaction_series where id = p_series_id;
  if not found or s.deleted_at is not null then
    return 0;
  end if;

  if auth.uid() is not null and not app.is_member(s.workspace_id) then
    raise exception 'not_authorized';
  end if;

  if s.kind = 'installment' then
    base := trunc(s.total_amount / s.installment_count, 2);
    remainder := s.total_amount - base * (s.installment_count - 1);
  end if;

  occurrence_date := s.first_due_date;
  while occurrence_date <= p_until loop
    exit when s.kind = 'installment' and n > s.installment_count;
    exit when s.end_date is not null and occurrence_date > s.end_date;

    if s.canceled_from_installment is null or n < s.canceled_from_installment then
      if s.kind = 'installment' then
        amount := case when n = s.installment_count then remainder else base end;
      else
        amount := s.planned_amount;
      end if;

      insert into transactions (
        workspace_id, nature, description, account_id, category_id,
        subcategory_id, income_class, purpose_classification,
        planned_amount, gross_amount_planned, tax_amount_planned,
        social_security_amount_planned, fee_amount_planned,
        commission_amount_planned, other_deductions_amount_planned,
        competence_month, due_date, status, series_id,
        installment_number, installment_count,
        payment_method_id, payment_instruction_id, investment_id,
        origin, note, created_by
      ) values (
        s.workspace_id, s.nature, s.description, s.account_id, s.category_id,
        s.subcategory_id, s.income_class, s.purpose_classification,
        amount, s.gross_amount_planned, s.tax_amount_planned,
        s.social_security_amount_planned, s.fee_amount_planned,
        s.commission_amount_planned, s.other_deductions_amount_planned,
        date_trunc('month', occurrence_date)::date, occurrence_date,
        'planned', s.id,
        n, s.installment_count,
        s.payment_method_id, s.payment_instruction_id, s.investment_id,
        'series', s.note, s.created_by
      )
      on conflict (series_id, installment_number)
        where series_id is not null
        do nothing;

      if found then
        created := created + 1;
      end if;
    end if;

    occurrence_date := (occurrence_date
      + app.series_step(s.frequency, s.custom_interval_days))::date;
    n := n + 1;
  end loop;

  return created;
end;
$$;

-- Aportes gerados por série também precisam da linha de vínculo 1:1.
create function app.sync_contribution_link()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.nature = 'investment_contribution' and new.investment_id is not null then
    insert into investment_contributions (workspace_id, investment_id, transaction_id, created_by)
    values (new.workspace_id, new.investment_id, new.id, new.created_by)
    on conflict (transaction_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger sync_contribution_link
  after insert on transactions
  for each row execute function app.sync_contribution_link();

-- ── Reserva de emergência ────────────────────────────────────────────────

alter table workspace_settings
  add column reserve_target_months int check (reserve_target_months between 1 and 60),
  add column reserve_manual_target numeric(14,2) check (reserve_manual_target >= 0);

-- Meta manual OU calculada: média mensal das despesas essenciais
-- realizadas nos últimos 6 meses fechados × meses desejados.
create function public.emergency_reserve_summary(p_workspace uuid)
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
    select coalesce(sum(t.actual_amount) / 6, 0)::numeric(14,2) as monthly_avg
      from transactions t, settings s
     where t.workspace_id = p_workspace
       and t.nature = 'consumer_expense'
       and t.status in ('realized', 'partially_realized')
       and t.deleted_at is null
       and t.category_id = any (s.essential_category_ids)
       and t.competence_month >= (date_trunc('month', current_date) - interval '6 months')::date
       and t.competence_month < date_trunc('month', current_date)::date
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

grant execute on function public.emergency_reserve_summary(uuid) to authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────

alter table investments enable row level security;
alter table investment_contributions enable row level security;

-- Investimentos: membros leem; gestão exige edit_investments
-- (owner sempre passa). Aportes (contributions) qualquer membro registra —
-- é atribuição padrão do assistente.
create policy investments_select on investments for select
  using (app.is_member(workspace_id) and deleted_at is null);
create policy investments_insert on investments for insert
  with check (app.has_permission(workspace_id, 'edit_investments'));
create policy investments_update on investments for update
  using (app.has_permission(workspace_id, 'edit_investments'))
  with check (app.has_permission(workspace_id, 'edit_investments')
              and deleted_at is null);
create policy investments_delete on investments for delete
  using (false);

create policy contributions_select on investment_contributions for select
  using (app.is_member(workspace_id));
create policy contributions_insert on investment_contributions for insert
  with check (app.is_member(workspace_id));
create policy contributions_delete on investment_contributions for delete
  using (app.has_permission(workspace_id, 'delete_transactions'));

revoke all on investments, investment_contributions from anon;
grant select, insert, update on investments to authenticated;
grant select, insert, delete on investment_contributions to authenticated;
