-- Phase 4: the financial core. `transactions` is the single source of truth;
-- planned and actual values coexist and never overwrite each other; series
-- materialization is idempotent; payment data is masked by default.

-- ── Enums ────────────────────────────────────────────────────────────────

create type transaction_nature as enum (
  'income', 'consumer_expense', 'consumer_financing',
  'investment_contribution', 'debt_payment', 'transfer',
  'project_cost', 'project_income', 'adjustment',
  'asset_acquisition', 'asset_sale');

create type transaction_status as enum (
  'planned', 'pending', 'partially_realized', 'realized',
  'overdue', 'no_demand', 'canceled');

create type purpose_classification as enum (
  'personal_consumption', 'investment', 'commercial_project', 'other');

create type recurrence_frequency as enum (
  'weekly', 'monthly', 'bimonthly', 'quarterly',
  'semiannual', 'annual', 'custom');

create type series_kind as enum ('recurring', 'installment');

create type income_class as enum (
  'active_fixed', 'active_variable', 'passive_fixed', 'passive_variable');

-- ── Payment instructions (sensitive: masked by default) ─────────────────

create table payment_instructions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  method payment_method_kind,
  payee text,
  pix_key_type pix_key_type,
  pix_key text,
  bank_name text,
  bank_code text,
  branch_number text,
  account_number text,
  account_kind text,
  digitable_line text,
  barcode text,
  boleto_id text,
  payment_link text,
  card_reference text,
  card_last4 char(4) check (card_last4 ~ '^[0-9]{4}$'),
  note text,
  extra_instructions text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_instructions_workspace_idx
  on payment_instructions (workspace_id);

create trigger set_updated_at before update on payment_instructions
  for each row execute function app.set_updated_at();
create trigger prevent_workspace_change before update on payment_instructions
  for each row execute function app.prevent_workspace_change();

-- ── Series (recurrences and installment plans) ───────────────────────────

create table transaction_series (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kind series_kind not null,
  nature transaction_nature not null,
  description text not null,
  frequency recurrence_frequency not null default 'monthly',
  custom_interval_days int check (custom_interval_days between 1 and 366),
  total_amount numeric(14,2) check (total_amount >= 0),
  installment_count int check (installment_count between 1 and 480),
  first_due_date date not null,
  end_date date,
  canceled_from_installment int,
  -- defaults applied to generated occurrences
  account_id uuid references financial_accounts (id),
  category_id uuid references categories (id),
  subcategory_id uuid references subcategories (id),
  planned_amount numeric(14,2) check (planned_amount >= 0),
  income_class income_class,
  purpose_classification purpose_classification,
  payment_method_id uuid references payment_methods (id),
  payment_instruction_id uuid references payment_instructions (id),
  gross_amount_planned numeric(14,2) check (gross_amount_planned >= 0),
  tax_amount_planned numeric(14,2) default 0 check (tax_amount_planned >= 0),
  social_security_amount_planned numeric(14,2) default 0 check (social_security_amount_planned >= 0),
  fee_amount_planned numeric(14,2) default 0 check (fee_amount_planned >= 0),
  commission_amount_planned numeric(14,2) default 0 check (commission_amount_planned >= 0),
  other_deductions_amount_planned numeric(14,2) default 0 check (other_deductions_amount_planned >= 0),
  note text,
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (kind <> 'installment' or (total_amount is not null and installment_count is not null)),
  check (frequency <> 'custom' or custom_interval_days is not null)
);

create index transaction_series_workspace_idx on transaction_series (workspace_id);

create trigger set_updated_at before update on transaction_series
  for each row execute function app.set_updated_at();
create trigger prevent_workspace_change before update on transaction_series
  for each row execute function app.prevent_workspace_change();

-- ── Transactions: single source of financial truth ───────────────────────

create table transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  account_id uuid references financial_accounts (id),
  counter_account_id uuid references financial_accounts (id),
  nature transaction_nature not null,
  purpose_classification purpose_classification,
  description text not null,
  category_id uuid references categories (id) on delete restrict,
  subcategory_id uuid references subcategories (id) on delete restrict,
  income_class income_class,

  planned_amount numeric(14,2) check (planned_amount >= 0),
  actual_amount numeric(14,2),

  gross_amount_planned numeric(14,2) check (gross_amount_planned >= 0),
  tax_amount_planned numeric(14,2) default 0 check (tax_amount_planned >= 0),
  social_security_amount_planned numeric(14,2) default 0 check (social_security_amount_planned >= 0),
  fee_amount_planned numeric(14,2) default 0 check (fee_amount_planned >= 0),
  commission_amount_planned numeric(14,2) default 0 check (commission_amount_planned >= 0),
  other_deductions_amount_planned numeric(14,2) default 0 check (other_deductions_amount_planned >= 0),
  net_amount_planned numeric(14,2) generated always as (
    case when gross_amount_planned is null then null
         else gross_amount_planned
              - coalesce(tax_amount_planned, 0)
              - coalesce(social_security_amount_planned, 0)
              - coalesce(fee_amount_planned, 0)
              - coalesce(commission_amount_planned, 0)
              - coalesce(other_deductions_amount_planned, 0)
    end) stored,

  gross_amount_actual numeric(14,2) check (gross_amount_actual >= 0),
  tax_amount_actual numeric(14,2) default 0 check (tax_amount_actual >= 0),
  social_security_amount_actual numeric(14,2) default 0 check (social_security_amount_actual >= 0),
  fee_amount_actual numeric(14,2) default 0 check (fee_amount_actual >= 0),
  commission_amount_actual numeric(14,2) default 0 check (commission_amount_actual >= 0),
  other_deductions_amount_actual numeric(14,2) default 0 check (other_deductions_amount_actual >= 0),
  net_amount_actual numeric(14,2) generated always as (
    case when gross_amount_actual is null then null
         else gross_amount_actual
              - coalesce(tax_amount_actual, 0)
              - coalesce(social_security_amount_actual, 0)
              - coalesce(fee_amount_actual, 0)
              - coalesce(commission_amount_actual, 0)
              - coalesce(other_deductions_amount_actual, 0)
    end) stored,

  competence_month date not null,
  due_date date,
  realized_date date,
  status transaction_status not null default 'planned',

  series_id uuid references transaction_series (id) on delete set null,
  installment_number int,
  installment_count int,

  payment_method_id uuid references payment_methods (id),
  payment_instruction_id uuid references payment_instructions (id),
  project_id uuid,
  asset_id uuid,
  liability_id uuid,
  investment_id uuid,

  origin text not null default 'manual',
  note text,
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  check (competence_month = date_trunc('month', competence_month)::date),
  check (nature <> 'transfer' or (counter_account_id is not null and category_id is null)),
  check (nature = 'transfer' or counter_account_id is null),
  check (status <> 'realized' or actual_amount is not null),
  check (status <> 'no_demand' or nature in ('consumer_expense', 'consumer_financing')),
  check (nature not in ('consumer_financing', 'debt_payment') or purpose_classification is not null),
  -- Apenas ajustes podem ter realizado negativo.
  check (nature = 'adjustment' or actual_amount is null or actual_amount >= 0)
);

create unique index transactions_series_installment_key
  on transactions (series_id, installment_number) where series_id is not null;
create index transactions_ws_competence_idx
  on transactions (workspace_id, competence_month) where deleted_at is null;
create index transactions_ws_nature_competence_idx
  on transactions (workspace_id, nature, competence_month) where deleted_at is null;
create index transactions_ws_status_due_idx
  on transactions (workspace_id, status, due_date) where deleted_at is null;
create index transactions_category_idx on transactions (workspace_id, category_id);
create index transactions_series_idx on transactions (series_id) where series_id is not null;

create trigger set_updated_at before update on transactions
  for each row execute function app.set_updated_at();
create trigger prevent_workspace_change before update on transactions
  for each row execute function app.prevent_workspace_change();

-- Receitas: bruto − descontos define o líquido; planned/actual_amount
-- espelham o líquido para que as agregações usem uma coluna única.
create function app.sync_income_amounts()
returns trigger
language plpgsql
as $$
begin
  if new.gross_amount_planned is not null then
    new.planned_amount :=
      new.gross_amount_planned
      - coalesce(new.tax_amount_planned, 0)
      - coalesce(new.social_security_amount_planned, 0)
      - coalesce(new.fee_amount_planned, 0)
      - coalesce(new.commission_amount_planned, 0)
      - coalesce(new.other_deductions_amount_planned, 0);
  end if;
  if new.gross_amount_actual is not null then
    new.actual_amount :=
      new.gross_amount_actual
      - coalesce(new.tax_amount_actual, 0)
      - coalesce(new.social_security_amount_actual, 0)
      - coalesce(new.fee_amount_actual, 0)
      - coalesce(new.commission_amount_actual, 0)
      - coalesce(new.other_deductions_amount_actual, 0);
  end if;
  return new;
end;
$$;

create trigger sync_income_amounts
  before insert or update on transactions
  for each row
  when (new.nature in ('income', 'project_income'))
  execute function app.sync_income_amounts();

-- Consistência categoria ↔ subcategoria ↔ workspace.
create function app.check_transaction_consistency()
returns trigger
language plpgsql
as $$
declare
  cat_ws uuid;
  sub_cat uuid;
begin
  if new.category_id is not null then
    select workspace_id into cat_ws from categories where id = new.category_id;
    if cat_ws is distinct from new.workspace_id then
      raise exception 'category must belong to the same workspace';
    end if;
  end if;
  if new.subcategory_id is not null then
    select category_id into sub_cat from subcategories
      where id = new.subcategory_id and workspace_id = new.workspace_id;
    if sub_cat is null or sub_cat is distinct from new.category_id then
      raise exception 'subcategory must belong to the selected category';
    end if;
  end if;
  return new;
end;
$$;

create trigger check_transaction_consistency
  before insert or update on transactions
  for each row execute function app.check_transaction_consistency();

-- ── Partial receipts/payments ────────────────────────────────────────────

create table transaction_installments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  transaction_id uuid not null references transactions (id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_at date not null default current_date,
  account_id uuid references financial_accounts (id),
  note text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index transaction_installments_tx_idx
  on transaction_installments (transaction_id);

-- Parciais somam no realizado do lançamento; o planejado fica intacto.
create function app.apply_partial_payments()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  tx transactions%rowtype;
  total numeric(14,2);
  last_date date;
begin
  select * into tx from transactions
    where id = coalesce(new.transaction_id, old.transaction_id)
    for update;

  select coalesce(sum(amount), 0), max(paid_at)
    into total, last_date
    from transaction_installments
   where transaction_id = tx.id;

  update transactions
     set actual_amount = case when total = 0 then null else total end,
         realized_date = last_date,
         status = case
           when total = 0 then
             case when tx.due_date is not null and tx.due_date < current_date
                  then 'overdue'::transaction_status
                  else 'planned'::transaction_status end
           when tx.planned_amount is not null and total >= tx.planned_amount
             then 'realized'::transaction_status
           else 'partially_realized'::transaction_status
         end
   where id = tx.id;

  return coalesce(new, old);
end;
$$;

create trigger apply_partial_payments
  after insert or delete on transaction_installments
  for each row execute function app.apply_partial_payments();

-- ── Series materialization (idempotent) ──────────────────────────────────

create function app.series_step(freq recurrence_frequency, custom_days int)
returns interval
language sql immutable
as $$
  select case freq
    when 'weekly' then interval '7 days'
    when 'monthly' then interval '1 month'
    when 'bimonthly' then interval '2 months'
    when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months'
    when 'annual' then interval '1 year'
    else make_interval(days => coalesce(custom_days, 30))
  end;
$$;

-- Cria as ocorrências ausentes da série até `until`. Nunca altera nem
-- duplica ocorrências existentes (realizadas ou não): a chave
-- (series_id, installment_number) + ON CONFLICT DO NOTHING garantem
-- idempotência.
create function public.generate_series_transactions(p_series_id uuid, p_until date)
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

  -- Autorização: geração manual exige membership; o cron usa service_role.
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
        payment_method_id, payment_instruction_id,
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
        s.payment_method_id, s.payment_instruction_id,
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

grant execute on function public.generate_series_transactions(uuid, date) to authenticated;

-- ── Overdue marking (idempotent; daily cron with service_role) ───────────

create function public.mark_overdue_transactions()
returns int
language sql security definer
set search_path = public
as $$
  with updated as (
    update transactions
       set status = 'overdue'
     where status in ('planned', 'pending')
       and due_date is not null
       and due_date < current_date
       and deleted_at is null
       and nature <> 'transfer'
    returning 1
  )
  select count(*)::int from updated;
$$;

revoke all on function public.mark_overdue_transactions() from public, anon, authenticated;

-- ── Masked payment data + audited reveal ─────────────────────────────────

create view payment_instructions_masked
with (security_invoker = false)
as
select
  id,
  workspace_id,
  method,
  payee,
  pix_key_type,
  case when pix_key is null then null
       else '•••' || right(pix_key, 4) end as pix_key_masked,
  bank_name,
  case when account_number is null then null
       else '•••' || right(account_number, 2) end as account_number_masked,
  case when digitable_line is null then null
       else '•••' || right(digitable_line, 6) end as digitable_line_masked,
  payment_link is not null as has_payment_link,
  card_last4,
  note
from payment_instructions
where app.is_member(workspace_id);

grant select on payment_instructions_masked to authenticated;

-- Dados completos: somente com permissão, sempre auditado.
create function public.reveal_payment_instruction(p_id uuid)
returns setof payment_instructions
language plpgsql security definer
set search_path = public
as $$
declare
  ws uuid;
begin
  select workspace_id into ws from payment_instructions where id = p_id;
  if ws is null then
    return;
  end if;
  if not app.has_permission(ws, 'view_full_payment_data') then
    raise exception 'not_authorized';
  end if;

  perform app.log_audit(ws, 'payment_instruction.revealed',
    'payment_instruction', p_id, 'Dados de pagamento completos visualizados');

  return query select * from payment_instructions where id = p_id;
end;
$$;

grant execute on function public.reveal_payment_instruction(uuid) to authenticated;

-- ── Aggregations (calculation lives in the database) ─────────────────────

create view account_balances
with (security_invoker = false)
as
select
  a.id as account_id,
  a.workspace_id,
  a.initial_balance
  + coalesce((
      select sum(
        case
          when t.nature in ('income', 'project_income', 'asset_sale', 'adjustment')
            then t.actual_amount
          when t.nature = 'transfer' then -t.actual_amount
          else -t.actual_amount
        end)
      from transactions t
      where t.account_id = a.id
        and t.deleted_at is null
        and t.actual_amount is not null
        and t.status in ('realized', 'partially_realized')
    ), 0)
  + coalesce((
      select sum(t.actual_amount)
      from transactions t
      where t.counter_account_id = a.id
        and t.nature = 'transfer'
        and t.deleted_at is null
        and t.actual_amount is not null
        and t.status in ('realized', 'partially_realized')
    ), 0) as balance
from financial_accounts a
where a.deleted_at is null
  and app.is_member(a.workspace_id);

grant select on account_balances to authenticated;

-- Previsto × realizado por natureza no período.
-- "Previsto ativo" exclui sem demanda e cancelados (CALCULATIONS.md).
create function public.monthly_cashflow(p_workspace uuid, p_from date, p_to date)
returns table (
  nature transaction_nature,
  planned_total numeric(14,2),
  actual_total numeric(14,2)
)
language sql stable
as $$
  select
    t.nature,
    coalesce(sum(t.planned_amount) filter (
      where t.status in ('planned','pending','partially_realized','realized','overdue')
    ), 0) as planned_total,
    coalesce(sum(t.actual_amount) filter (
      where t.status in ('realized','partially_realized')
    ), 0) as actual_total
  from transactions t
  where t.workspace_id = p_workspace
    and app.is_member(t.workspace_id)
    and t.deleted_at is null
    and t.nature <> 'transfer'
    and t.competence_month between date_trunc('month', p_from)::date
                               and date_trunc('month', p_to)::date
  group by t.nature;
$$;

grant execute on function public.monthly_cashflow(uuid, date, date) to authenticated;

-- Demonstrativo de receitas: bruto, descontos e líquido (previsto × real).
create function public.income_statement(p_workspace uuid, p_from date, p_to date)
returns table (
  gross_planned numeric(14,2),
  deductions_planned numeric(14,2),
  net_planned numeric(14,2),
  gross_actual numeric(14,2),
  deductions_actual numeric(14,2),
  net_actual numeric(14,2)
)
language sql stable
as $$
  -- Receitas sem detalhamento de descontos contam bruto = líquido.
  select
    coalesce(sum(coalesce(gross_amount_planned, planned_amount)) filter (where status not in ('canceled','no_demand')), 0),
    coalesce(sum(coalesce(gross_amount_planned - net_amount_planned, 0)) filter (where status not in ('canceled','no_demand')), 0),
    coalesce(sum(coalesce(net_amount_planned, planned_amount)) filter (where status not in ('canceled','no_demand')), 0),
    coalesce(sum(coalesce(gross_amount_actual, actual_amount)) filter (where status in ('realized','partially_realized')), 0),
    coalesce(sum(coalesce(gross_amount_actual - net_amount_actual, 0)) filter (where status in ('realized','partially_realized')), 0),
    coalesce(sum(coalesce(net_amount_actual, actual_amount)) filter (where status in ('realized','partially_realized')), 0)
  from transactions
  where workspace_id = p_workspace
    and app.is_member(workspace_id)
    and deleted_at is null
    and nature = 'income'
    and competence_month between date_trunc('month', p_from)::date
                             and date_trunc('month', p_to)::date;
$$;

grant execute on function public.income_statement(uuid, date, date) to authenticated;

-- ── Soft delete (função auditada; exige delete_transactions) ────────────

create function public.soft_delete_transaction(p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  tx transactions%rowtype;
begin
  select * into tx from transactions
   where id = p_id and deleted_at is null
   for update;
  if not found then
    return false;
  end if;
  if not app.has_permission(tx.workspace_id, 'delete_transactions') then
    raise exception 'not_authorized';
  end if;

  update transactions
     set deleted_at = now(), updated_by = auth.uid()
   where id = p_id;

  perform app.log_audit(tx.workspace_id, 'transaction.deleted',
    'transaction', p_id,
    'Lançamento "' || tx.description || '" excluído (exclusão lógica)');

  return true;
end;
$$;

grant execute on function public.soft_delete_transaction(uuid) to authenticated;

create function public.soft_delete_series(p_id uuid, p_delete_pending boolean default true)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  s transaction_series%rowtype;
begin
  select * into s from transaction_series
   where id = p_id and deleted_at is null
   for update;
  if not found then
    return false;
  end if;
  if not app.has_permission(s.workspace_id, 'delete_transactions') then
    raise exception 'not_authorized';
  end if;

  update transaction_series
     set deleted_at = now(), updated_by = auth.uid()
   where id = p_id;

  -- Ocorrências realizadas/parciais são preservadas sempre.
  if p_delete_pending then
    update transactions
       set deleted_at = now(), updated_by = auth.uid()
     where series_id = p_id
       and deleted_at is null
       and status in ('planned', 'pending', 'overdue');
  end if;

  perform app.log_audit(s.workspace_id, 'series.deleted',
    'transaction_series', p_id,
    'Série "' || s.description || '" excluída (exclusão lógica)');

  return true;
end;
$$;

grant execute on function public.soft_delete_series(uuid, boolean) to authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────

alter table transactions enable row level security;
alter table transaction_series enable row level security;
alter table transaction_installments enable row level security;
alter table payment_instructions enable row level security;

-- transactions: membros leem e escrevem (assistente registra lançamentos).
-- Exclusão lógica NUNCA por UPDATE direto: as policies exigem
-- deleted_at nulo; a exclusão passa pela função auditada
-- soft_delete_transaction (permissão delete_transactions).
create policy tx_select on transactions for select
  using (app.is_member(workspace_id) and deleted_at is null);
create policy tx_insert on transactions for insert
  with check (app.is_member(workspace_id) and deleted_at is null);
create policy tx_update on transactions for update
  using (app.is_member(workspace_id))
  with check (app.is_member(workspace_id) and deleted_at is null);

create policy series_select on transaction_series for select
  using (app.is_member(workspace_id) and deleted_at is null);
create policy series_insert on transaction_series for insert
  with check (app.is_member(workspace_id) and deleted_at is null);
create policy series_update on transaction_series for update
  using (app.is_member(workspace_id))
  with check (app.is_member(workspace_id) and deleted_at is null);

create policy parts_select on transaction_installments for select
  using (app.is_member(workspace_id));
create policy parts_insert on transaction_installments for insert
  with check (app.is_member(workspace_id) and created_by = auth.uid());
create policy parts_delete on transaction_installments for delete
  using (app.has_permission(workspace_id, 'delete_transactions'));

-- payment_instructions: membros criam/atualizam; leitura direta da tabela
-- exige view_full_payment_data (listagens usam a view mascarada).
create policy pi_select on payment_instructions for select
  using (app.has_permission(workspace_id, 'view_full_payment_data'));
create policy pi_insert on payment_instructions for insert
  with check (app.is_member(workspace_id) and created_by = auth.uid());
create policy pi_update on payment_instructions for update
  using (app.is_member(workspace_id)) with check (app.is_member(workspace_id));
create policy pi_delete on payment_instructions for delete
  using (app.is_owner(workspace_id));

-- ── Grants ───────────────────────────────────────────────────────────────

revoke all on transactions, transaction_series, transaction_installments,
  payment_instructions from anon;
grant select, insert, update on transactions, transaction_series to authenticated;
grant select, insert, delete on transaction_installments to authenticated;
grant select, insert, update, delete on payment_instructions to authenticated;
-- Hard delete de transações não existe para usuários (exclusão é lógica).
