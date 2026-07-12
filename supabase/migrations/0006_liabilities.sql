-- Phase 6: liabilities (debts) and debt payments. A payment is ONE
-- transaction (nature debt_payment) linked 1:1 to the liability: cash goes
-- down, debt balance goes down, paid amount goes up — atomically, never
-- double-counted. Only personal-consumption purpose enters the 20% rule.

create type liability_status as enum (
  'active', 'current', 'overdue', 'renegotiated', 'settled', 'canceled');

create type interest_type as enum (
  'none', 'fixed_rate', 'price_table', 'sac', 'simple', 'compound', 'other');

create table liabilities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  creditor text,
  category_id uuid references categories (id),
  subcategory_id uuid references subcategories (id),
  purpose_classification purpose_classification not null,
  original_amount numeric(14,2) not null check (original_amount >= 0),
  current_balance numeric(14,2) not null default 0 check (current_balance >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  interest_rate numeric(8,4) check (interest_rate >= 0),
  interest_type interest_type not null default 'none',
  installment_count int check (installment_count between 1 and 600),
  installments_remaining int,
  installment_amount numeric(14,2) check (installment_amount >= 0),
  start_date date,
  final_due_date date,
  next_due_date date,
  asset_id uuid,
  project_id uuid,
  payment_instruction_id uuid references payment_instructions (id),
  status liability_status not null default 'active',
  note text,
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index liabilities_workspace_idx
  on liabilities (workspace_id) where deleted_at is null;
create index liabilities_next_due_idx
  on liabilities (workspace_id, next_due_date)
  where status in ('active', 'current', 'overdue');

create table liability_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  liability_id uuid not null references liabilities (id) on delete cascade,
  transaction_id uuid not null unique references transactions (id) on delete cascade,
  principal_amount numeric(14,2) check (principal_amount >= 0),
  interest_amount numeric(14,2) check (interest_amount >= 0),
  note text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index liability_payments_liability_idx
  on liability_payments (liability_id);

create trigger set_updated_at before update on liabilities
  for each row execute function app.set_updated_at();
create trigger prevent_workspace_change before update on liabilities
  for each row execute function app.prevent_workspace_change();
create trigger prevent_workspace_change before update on liability_payments
  for each row execute function app.prevent_workspace_change();

alter table transactions
  add constraint transactions_liability_fk
  foreign key (liability_id) references liabilities (id) on delete set null;
alter table transaction_series
  add column liability_id uuid references liabilities (id) on delete set null;

-- Recompute (idempotente): pago = Σ realizados; saldo = original − pago;
-- parcelas restantes e próximo vencimento derivados das ocorrências.
-- Pagamento de dívida NUNCA altera o valor de bens (patrimônio bruto).
create function app.recompute_liability(p_liability uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  l liabilities%rowtype;
  total_paid numeric(14,2);
  paid_count int;
  next_due date;
begin
  select * into l from liabilities where id = p_liability;
  if not found then
    return;
  end if;

  select coalesce(sum(t.actual_amount), 0),
         count(*) filter (where t.status = 'realized')
    into total_paid, paid_count
    from transactions t
   where t.liability_id = p_liability
     and t.nature = 'debt_payment'
     and t.status in ('realized', 'partially_realized')
     and t.deleted_at is null;

  select min(t.due_date) into next_due
    from transactions t
   where t.liability_id = p_liability
     and t.nature = 'debt_payment'
     and t.status in ('planned', 'pending', 'overdue', 'partially_realized')
     and t.deleted_at is null;

  update liabilities
     set paid_amount = total_paid,
         current_balance = greatest(0, original_amount - total_paid),
         installments_remaining = case
           when installment_count is null then null
           else greatest(0, installment_count - paid_count)
         end,
         next_due_date = next_due,
         status = case
           when status in ('canceled', 'renegotiated') then status
           when original_amount - total_paid <= 0 then 'settled'
           when exists (
             select 1 from transactions t
              where t.liability_id = p_liability
                and t.nature = 'debt_payment'
                and t.status = 'overdue'
                and t.deleted_at is null
           ) then 'overdue'
           else 'current'
         end
   where id = p_liability;
end;
$$;

create function app.sync_liability_state()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.liability_id is not null then
    perform app.recompute_liability(new.liability_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.liability_id is not null
     and (tg_op = 'DELETE' or old.liability_id is distinct from new.liability_id) then
    perform app.recompute_liability(old.liability_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger sync_liability_state
  after insert or update or delete on transactions
  for each row execute function app.sync_liability_state();

-- Vínculo 1:1 automático (manual e via série).
create function app.sync_liability_payment_link()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.nature = 'debt_payment' and new.liability_id is not null then
    insert into liability_payments (workspace_id, liability_id, transaction_id, created_by)
    values (new.workspace_id, new.liability_id, new.id, new.created_by)
    on conflict (transaction_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger sync_liability_payment_link
  after insert on transactions
  for each row execute function app.sync_liability_payment_link();

-- Séries propagam liability_id (e purpose vem da própria série).
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
        payment_method_id, payment_instruction_id, investment_id, liability_id,
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
        s.payment_method_id, s.payment_instruction_id, s.investment_id, s.liability_id,
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

-- ── Simulação de quitação antecipada ─────────────────────────────────────

create function public.simulate_liability_payoff(
  p_liability uuid,
  p_extra_monthly numeric(14,2) default 0
)
returns table (
  months_remaining int,
  projected_finish date,
  monthly_payment numeric(14,2),
  total_to_pay numeric(14,2)
)
language sql stable
as $$
  select
    case when l.installment_amount + coalesce(p_extra_monthly, 0) > 0
         then ceil(l.current_balance / (l.installment_amount + coalesce(p_extra_monthly, 0)))::int
         else null end,
    case when l.installment_amount + coalesce(p_extra_monthly, 0) > 0
         then (current_date + make_interval(
                months => ceil(l.current_balance
                  / (l.installment_amount + coalesce(p_extra_monthly, 0)))::int))::date
         else null end,
    (l.installment_amount + coalesce(p_extra_monthly, 0))::numeric(14,2),
    l.current_balance
  from liabilities l
  where l.id = p_liability
    and app.is_member(l.workspace_id)
    and l.deleted_at is null;
$$;

grant execute on function public.simulate_liability_payoff(uuid, numeric) to authenticated;

-- ── Regra 50/20/30 (fonte de verdade no banco; igualdade está DENTRO) ────

create function public.rule_50_20_30(p_workspace uuid, p_from date, p_to date)
returns table (
  net_income numeric(14,2),
  expenses numeric(14,2),
  financing numeric(14,2),
  investments numeric(14,2),
  pct_expenses numeric(7,2),
  pct_financing numeric(7,2),
  pct_investments numeric(7,2),
  expenses_status text,
  financing_status text,
  investments_status text,
  unallocated numeric(14,2),
  excess numeric(14,2)
)
language sql stable
as $$
  with base as (
    select
      coalesce(sum(coalesce(t.net_amount_actual, t.actual_amount))
        filter (where t.nature = 'income'
                  and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as rl,
      coalesce(sum(t.actual_amount)
        filter (where t.nature = 'consumer_expense'
                  and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as exp,
      -- 20%: SOMENTE finalidade consumo próprio (financiamentos + dívidas).
      coalesce(sum(t.actual_amount)
        filter (where t.nature in ('consumer_financing', 'debt_payment')
                  and t.purpose_classification = 'personal_consumption'
                  and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as fin,
      coalesce(sum(t.actual_amount)
        filter (where t.nature = 'investment_contribution'
                  and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as inv,
      coalesce(sum(t.actual_amount)
        filter (where t.nature in ('consumer_expense', 'consumer_financing',
                                   'debt_payment', 'investment_contribution')
                  and t.status in ('realized', 'partially_realized')), 0)::numeric(14,2) as outflows
    from transactions t
    where t.workspace_id = p_workspace
      and app.is_member(t.workspace_id)
      and t.deleted_at is null
      and t.competence_month between date_trunc('month', p_from)::date
                                 and date_trunc('month', p_to)::date
  )
  select
    b.rl,
    b.exp,
    b.fin,
    b.inv,
    case when b.rl > 0 then round(b.exp * 100 / b.rl, 2) end,
    case when b.rl > 0 then round(b.fin * 100 / b.rl, 2) end,
    case when b.rl > 0 then round(b.inv * 100 / b.rl, 2) end,
    -- Comparações sobre os valores EXATOS (nunca sobre o arredondado):
    -- exatamente 50%/20% = dentro; exatamente 30% = mínimo cumprido.
    case when b.rl <= 0 then 'no_base'
         when b.exp * 100 <= b.rl * 50 then 'within' else 'above' end,
    case when b.rl <= 0 then 'no_base'
         when b.fin * 100 <= b.rl * 20 then 'within' else 'above' end,
    case when b.rl <= 0 then 'no_base'
         when b.inv * 100 >= b.rl * 30 then 'at_or_above_minimum'
         else 'below_minimum' end,
    greatest(0, b.rl - b.exp - b.fin - b.inv)::numeric(14,2),
    greatest(0, b.outflows - b.rl)::numeric(14,2)
  from base b;
$$;

grant execute on function public.rule_50_20_30(uuid, date, date) to authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────

alter table liabilities enable row level security;
alter table liability_payments enable row level security;

-- Dívidas: membros leem; gestão exige edit_liabilities. Pagamentos
-- (transações + vínculo) qualquer membro registra — atribuição padrão.
create policy liabilities_select on liabilities for select
  using (app.is_member(workspace_id) and deleted_at is null);
create policy liabilities_insert on liabilities for insert
  with check (app.has_permission(workspace_id, 'edit_liabilities'));
create policy liabilities_update on liabilities for update
  using (app.has_permission(workspace_id, 'edit_liabilities'))
  with check (app.has_permission(workspace_id, 'edit_liabilities')
              and deleted_at is null);
create policy liabilities_delete on liabilities for delete
  using (false);

create policy liability_payments_select on liability_payments for select
  using (app.is_member(workspace_id));
create policy liability_payments_insert on liability_payments for insert
  with check (app.is_member(workspace_id));
create policy liability_payments_delete on liability_payments for delete
  using (app.has_permission(workspace_id, 'delete_transactions'));

revoke all on liabilities, liability_payments from anon;
grant select, insert, update on liabilities to authenticated;
grant select, insert, delete on liability_payments to authenticated;
