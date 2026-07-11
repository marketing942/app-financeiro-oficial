# DOMÍNIO FINANCEIRO — Modelo de Dados, Constraints e RLS

Fonte de verdade do schema. Migrations em `supabase/migrations/`.
Todos os valores monetários: `numeric(14,2)`. Todos os IDs: `uuid`
(`gen_random_uuid()`). Todas as tabelas de negócio: `created_at`,
`updated_at` (trigger), e as financeiras também `created_by`, `updated_by`,
`deleted_at` (exclusão lógica).

## 1. Convenções e enums

```sql
-- Papéis e acesso
create type member_role as enum ('owner', 'assistant');
create type member_status as enum ('active', 'revoked');
create type invitation_status as enum ('pending', 'accepted', 'expired', 'revoked');

-- Financeiro central
create type transaction_nature as enum (
  'income', 'consumer_expense', 'consumer_financing',
  'investment_contribution', 'debt_payment', 'transfer',
  'project_cost', 'project_income', 'adjustment',
  'asset_acquisition', 'asset_sale');

create type transaction_status as enum (
  'planned',            -- previsto
  'pending',            -- a pagar / a receber
  'partially_realized', -- pago/recebido parcialmente
  'realized',           -- pago/recebido/realizado
  'overdue',            -- atrasado/vencido
  'no_demand',          -- sem demanda (despesas)
  'canceled');
-- Labels em pt-BR são resolvidos na UI por natureza
-- (ex.: realized => "recebido" p/ receita, "pago" p/ despesa).

create type purpose_classification as enum (
  'personal_consumption', 'investment', 'commercial_project', 'other');

create type recurrence_frequency as enum (
  'weekly', 'monthly', 'bimonthly', 'quarterly',
  'semiannual', 'annual', 'custom');

create type series_kind as enum ('recurring', 'installment');

create type account_type as enum (
  'checking', 'cash', 'digital_wallet', 'savings',
  'investment', 'credit_card', 'project', 'other');

create type category_kind as enum ('income', 'expense', 'project_cost');
create type income_class as enum (
  'active_fixed', 'active_variable', 'passive_fixed', 'passive_variable');

create type payment_method_kind as enum (
  'pix', 'boleto', 'bank_transfer', 'debit', 'credit',
  'credit_installments', 'cash', 'auto_debit', 'other');
create type pix_key_type as enum ('cpf', 'cnpj', 'email', 'phone', 'random');

-- Dívidas, ativos, projetos, metas, alertas
create type liability_status as enum (
  'active', 'current', 'overdue', 'renegotiated', 'settled', 'canceled');
create type interest_type as enum ('fixed', 'price_table', 'sac', 'simple', 'compound', 'none', 'other');

create type asset_status as enum ('active', 'sold', 'written_off', 'archived');
create type asset_event_type as enum (
  'acquisition', 'appraisal', 'appreciation', 'depreciation',
  'improvement', 'contribution', 'amortization', 'sale', 'write_off', 'adjustment');

create type project_status as enum (
  'planning', 'in_progress', 'paused', 'ready_for_sale',
  'sold', 'completed', 'canceled');

create type goal_type as enum (
  'income', 'expense_limit', 'contribution', 'reserve', 'investment',
  'project', 'debt_payoff', 'acquisition', 'gross_worth',
  'liability_reduction', 'net_worth', 'custom');
create type goal_status as enum (
  'not_started', 'ahead', 'on_track', 'attention',
  'behind', 'completed', 'expired');

create type alert_severity as enum ('info', 'attention', 'critical', 'success');
create type ai_role as enum ('user', 'assistant', 'system', 'tool');
```

## 2. Identidade e espaços

### profiles
Espelho de `auth.users` (criado por trigger `on auth.users insert`).
| coluna | tipo | regras |
|---|---|---|
| id | uuid PK | = `auth.users.id` |
| full_name | text | |
| avatar_url | text | |
| timezone | text | default `America/Recife` |
| locale | text | default `pt-BR` |

### workspaces
| id PK | name text not null | owner_id uuid FK profiles | currency text default 'BRL' | deleted_at |

### workspace_members
| id PK | workspace_id FK | user_id FK profiles | role member_role | status member_status default 'active' | permissions jsonb default '{}' | invited_by uuid | last_access_at | revoked_at |
- `unique (workspace_id, user_id)`
- `permissions`: flags extras do assistente (`delete_transactions`,
  `edit_categories`, `edit_goals`, `edit_assets`, `edit_investments`,
  `edit_liabilities`, `edit_projects`, `export_reports`,
  `view_full_payment_data`, `use_nylo_advanced`).
- Revogação = `status='revoked'` + `revoked_at` → RLS nega imediatamente.

### workspace_invitations
| id PK | workspace_id FK | email citext | role member_role default 'assistant' | permissions jsonb | token_hash text unique | status invitation_status | expires_at timestamptz | invited_by | accepted_by | accepted_at |
- Token: 32 bytes aleatórios; **somente o hash (sha256) é armazenado**.
- Check: `expires_at > created_at`. Aceite valida hash + validade + e-mail.

### role_permissions
Catálogo de permissões por papel (defaults declarativos):
| id PK | role member_role | permission text | granted boolean |
- `unique (role, permission)`. Overrides individuais vivem em
  `workspace_members.permissions`.

### user_preferences
| user_id PK FK profiles | theme text ('light'/'dark'/'system') | privacy_mode boolean | dashboard_prefs jsonb | nylo_prefs jsonb |

### workspace_settings
| workspace_id PK FK | month_start_day int default 1 check (1..28) | default_tolerance numeric(5,2) | alert_threshold numeric(5,2) default 80 | essential_category_ids uuid[] | dashboard_prefs jsonb | nylo_history_enabled boolean default true | nylo_retention_days int default 90 | nylo_monthly_message_limit int |

## 3. Contas, categorias, pagamento

### financial_accounts
| id PK | workspace_id | name | type account_type | institution | initial_balance numeric(14,2) default 0 | credit_limit numeric(14,2) | color | icon | archived_at | note | + auditoria/soft delete |
- **Saldo calculado**, nunca armazenado: view `account_balances` =
  `initial_balance` + Σ transações realizadas da conta (entradas − saídas,
  transferências consideradas nos dois lados).

### categories / subcategories
categories: | id PK | workspace_id | kind category_kind | name | icon | color | sort_order int | is_default boolean | archived_at |
subcategories: | id PK | category_id FK | workspace_id | name | icon | color | sort_order | archived_at |
- `unique (workspace_id, kind, name)` parcial (`archived_at is null`).
- Arquivar não apaga lançamentos (FK `on delete restrict`).
- Hierarquia máxima: categoria → subcategoria (imposta pelo modelo).

### payment_methods
Cartões/métodos salvos do workspace: | id PK | workspace_id | kind payment_method_kind | label | account_id FK financial_accounts | card_last4 char(4) | note | archived_at |

### payment_instructions
Instruções de pagamento vinculáveis a transações/dívidas:
| id PK | workspace_id | method payment_method_kind | payee | pix_key_type | pix_key | bank_name | bank_code | branch | account_number | account_kind | digitable_line | barcode | boleto_id | payment_link | card_reference | card_last4 char(4) | note | extra_instructions |
- **Proibido por design**: senha, token, CVV, número completo de cartão
  (não existem colunas; validação Zod rejeita padrões de PAN/CVV).
- Leitura completa auditada; listagens usam view mascarada
  `payment_instructions_masked` (pix_key/digitable_line/account truncados).

## 4. Núcleo financeiro

### transaction_series
Série (recorrência ou parcelamento) que gera transações-filhas:
| id PK | workspace_id | kind series_kind | nature transaction_nature | description | frequency recurrence_frequency | custom_interval_days int | total_amount numeric(14,2) | installment_count int | first_due_date date | end_date | default_* (categoria, conta, valores, instrução) | canceled_from_installment int | + auditoria |
- Materialização idempotente: função `generate_series_transactions(series_id, until date)`
  cria filhas ausentes (chave `unique (series_id, installment_number)`),
  **nunca toca filhas com status realizado/parcial**.

### transactions  — fonte única de verdade
| coluna | tipo | observações |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK not null | imutável (trigger bloqueia update) |
| account_id | uuid FK financial_accounts | conta de origem/destino |
| counter_account_id | uuid FK | obrigatória se `nature='transfer'` (check) |
| nature | transaction_nature not null | |
| purpose_classification | purpose_classification | obrigatória p/ `consumer_financing` e `debt_payment` (check) |
| description | text not null | |
| category_id / subcategory_id | uuid FK | subcategoria deve pertencer à categoria (trigger) |
| planned_amount | numeric(14,2) | valor previsto (líquido p/ receitas) |
| actual_amount | numeric(14,2) | valor realizado |
| gross_amount_planned / gross_amount_actual | numeric(14,2) | receitas |
| tax_amount_planned / _actual | numeric(14,2) | |
| social_security_amount_planned / _actual | numeric(14,2) | |
| fee_amount_planned / _actual | numeric(14,2) | |
| commission_amount_planned / _actual | numeric(14,2) | |
| other_deductions_amount_planned / _actual | numeric(14,2) | |
| net_amount_planned / net_amount_actual | numeric(14,2) **generated** | bruto − Σ descontos (ver CALCULATIONS §2) |
| competence_month | date not null | sempre dia 1 (check) |
| due_date | date | data prevista |
| realized_date | date | data realizada |
| status | transaction_status not null default 'planned' | |
| series_id | uuid FK transaction_series | |
| installment_number / installment_count | int | `unique (series_id, installment_number)` |
| payment_method_id | uuid FK payment_methods | |
| payment_instruction_id | uuid FK payment_instructions | |
| project_id | uuid FK business_projects | |
| asset_id | uuid FK assets | |
| liability_id | uuid FK liabilities | |
| investment_id | uuid FK investments | |
| origin | text | 'manual', 'series', 'nylo_draft', 'import' |
| note | text | |
| created_by / updated_by | uuid | |
| created_at / updated_at / deleted_at | timestamptz | |

Checks principais:
- `planned_amount >= 0`, `actual_amount >= 0`, descontos `>= 0`;
- `nature='transfer'` ⇒ `counter_account_id is not null` e
  `category_id is null`;
- `status='realized'` ⇒ `actual_amount is not null`;
- `competence_month = date_trunc('month', competence_month)`.

Triggers:
- bloquear alteração de `workspace_id`;
- impedir hard delete quando existir histórico (usar `deleted_at`);
- consistência categoria↔subcategoria e vínculos (projeto/dívida/ativo do
  mesmo workspace).

### transaction_installments
Pagamentos/recebimentos parciais de uma transação:
| id PK | workspace_id | transaction_id FK | amount numeric(14,2) check (>0) | paid_at date | account_id | note | created_by |
- `actual_amount` da transação = Σ parciais (mantido por trigger);
  status vira `partially_realized`/`realized` conforme total.

## 5. Investimentos

### investments
| id PK | workspace_id | group ('real_estate','long_term','emergency_opportunity','future_projects') | subgroup text | name | description | initial_amount | current_balance numeric(14,2) | target_amount | start_date | end_date | account_id FK | asset_id FK | expected_return_note | archived_at | note |
- `current_balance` mantido por trigger a partir de aportes/resgates
  (auditável via `investment_contributions`).

### investment_contributions
Aporte = linha própria **+** transação `investment_contribution` (1:1 via
`transaction_id`), garantindo caixa e investimento sincronizados sem dupla
contabilização:
| id PK | workspace_id | investment_id FK | transaction_id FK unique | planned_amount | actual_amount | planned_date | realized_date | status transaction_status | note |

Reserva de emergência: investimento do grupo `emergency_opportunity` +
configuração em `workspace_settings.essential_category_ids` + meta tipo
`reserve` (cálculo em CALCULATIONS §5.4).

## 6. Dívidas

### liabilities
| id PK | workspace_id | name | creditor | category_id/subcategory_id | purpose_classification not null | original_amount | current_balance numeric(14,2) | paid_amount numeric(14,2) default 0 | interest_rate numeric(8,4) | interest_type | installment_count | installments_remaining | installment_amount | start_date | final_due_date | next_due_date | asset_id FK | project_id FK | payment_instruction_id | status liability_status | note | + auditoria |
- Check: `current_balance >= 0`, `paid_amount >= 0`.

### liability_payments
Pagamento = linha própria **+** transação `debt_payment` (1:1):
| id PK | workspace_id | liability_id FK | transaction_id FK unique | planned_amount | actual_amount | principal_amount | interest_amount | planned_date | realized_date | installment_number | status | note |
- Trigger: ao realizar, decrementa `liabilities.current_balance`
  (não abaixo de 0), incrementa `paid_amount`, recalcula
  `installments_remaining`/`next_due_date`; quitação ⇒ `status='settled'`.
- **Não altera valor de ativos** (patrimônio bruto intacto).

## 7. Patrimônio

### assets
| id PK | workspace_id | name | type ('property','land','vehicle','company','equity_stake','financial','equipment','construction','capitalizable_project','other') | category text | purchase_value | purchase_date | current_value numeric(14,2) | valuation_date | valuation_source | ownership_percent numeric(5,2) default 100 check (0..100) | liability_id FK | project_id FK | status asset_status | sale_value | sale_date | sale_account_id | sale_costs | note | + auditoria |

### asset_valuations
Histórico de eventos/avaliações (nunca sobrescrever histórico):
| id PK | workspace_id | asset_id FK | event_type asset_event_type | value numeric(14,2) | event_date | source | note | created_by |
- `assets.current_value` = valor do evento mais recente (trigger).

### net_worth_snapshots
| id PK | workspace_id | snapshot_date date | gross_worth | total_liabilities | net_worth | investments_total | cash_total | debts_total | created_at |
- `unique (workspace_id, snapshot_date)` → idempotência do cron mensal;
  função `create_net_worth_snapshot(workspace_id, date)` faz upsert.

## 8. Negócios e projetos

### business_projects
| id PK | workspace_id | name | type ('construction_for_sale','buy_and_renovate','vehicle_trade','land','venture','commercial','other') | description | start_date | expected_end_date | end_date | budget numeric(14,2) | initial_capital | expected_sale_value | status project_status | responsible_id uuid | note | + auditoria |
- Capital investido, custos, receitas, lucro, margem, ROI: **calculados**
  pela view `project_financials` (CALCULATIONS §6) — nunca armazenados.

### project_stages
| id PK | workspace_id | project_id FK | name | sort_order | start_date | end_date | status | note |

### project_transactions
View sobre `transactions` filtrando `project_id is not null`
(natures `project_cost`, `project_income`, `investment_contribution`).
Não é tabela — evita dupla contabilização.

### project_assets
| id PK | workspace_id | project_id FK | asset_id FK | unique (project_id, asset_id) |

### project_documents
| id PK | workspace_id | project_id FK | name | storage_path (Supabase Storage) | mime_type | size_bytes | uploaded_by |

### project_members
| id PK | workspace_id | project_id FK | user_id FK | role text | unique (project_id, user_id) |

## 9. Metas, limites, alertas

### goals
| id PK | workspace_id | name | type goal_type | related_entity_type text | related_entity_id uuid | initial_value | target_value numeric(14,2) not null | current_value_override numeric(14,2) | start_date | end_date | priority int | status goal_status | archived_at | note | + auditoria |
- `current_value` é resolvido pela função `goal_progress(goal)` conforme o
  tipo (ex.: `net_worth` lê agregado patrimonial; `contribution` soma aportes
  do período). Override manual só para tipo `custom`.
- Marcos (mensal/anual/5/10/15 anos) derivados de `start_date`/`end_date` —
  **uma meta, vários marcos**, sem duplicação.

### category_limits
| id PK | workspace_id | category_id FK | subcategory_id FK nullable | monthly_limit | annual_limit | tolerance_percent numeric(5,2) default 0 | valid_from date | valid_until date | active boolean |
- `unique (workspace_id, category_id, subcategory_id, valid_from)`.

### alerts
| id PK | workspace_id | rule_key text | severity alert_severity | title | body | amount numeric(14,2) | reference_date date | action_label | action_url | entity_type | entity_id | seen_at | resolved_at | created_at |
- `unique (workspace_id, rule_key, entity_id, reference_date)` →
  recomputação idempotente pela função `recompute_alerts(workspace_id, period)`.

## 10. Auditoria

### audit_logs
| id PK | workspace_id | user_id | action text | entity_type text | entity_id uuid | summary text | metadata jsonb | created_at |
- **Append-only**: sem policies de UPDATE/DELETE (nem para owner).
- INSERT via funções `security definer` do data-access layer.
- Eventos: criação/edição/exclusão/restauração, pagamento, recebimento,
  aporte, patrimônio, dívida, projeto, convite, revogação, permissão,
  visualização de dados de pagamento completos, chamadas de escrita da Nylo.

## 11. Nylo (IA)

### ai_conversations
| id PK | workspace_id | user_id | title | archived_at | expires_at | created_at | updated_at |
- `expires_at` = retenção configurada; cron remove expiradas.

### ai_messages
| id PK | conversation_id FK | workspace_id | user_id | role ai_role | content text | content_json jsonb (tabelas/gráficos estruturados) | token_count int | created_at |

### ai_tool_calls
| id PK | message_id FK | workspace_id | user_id | tool_name text | arguments jsonb | result_summary text | status ('ok','denied','error') | duration_ms int | created_at |

### ai_feedback
| id PK | message_id FK | workspace_id | user_id | rating ('up','down') | comment | created_at |

### ai_usage_logs
| id PK | workspace_id | user_id | model text | input_tokens int | output_tokens int | estimated_cost_usd numeric(10,6) | conversation_id | created_at |
- Base do rate limiting por usuário e por workspace (janelas por contagem).

## 12. Índices

Além de PKs/uniques:
```sql
-- padrão para toda tabela com workspace_id:
create index on <t> (workspace_id);

-- transactions (consultas por período dominam):
create index on transactions (workspace_id, competence_month) where deleted_at is null;
create index on transactions (workspace_id, nature, competence_month) where deleted_at is null;
create index on transactions (workspace_id, status, due_date) where deleted_at is null;
create index on transactions (workspace_id, category_id);
create index on transactions (series_id);
create index on transactions (project_id) where project_id is not null;
create index on transactions (liability_id) where liability_id is not null;
create index on transactions (investment_id) where investment_id is not null;

create index on workspace_members (user_id) where status = 'active';
create index on workspace_invitations (token_hash);
create index on alerts (workspace_id, seen_at) where resolved_at is null;
create index on audit_logs (workspace_id, created_at desc);
create index on ai_messages (conversation_id, created_at);
create index on net_worth_snapshots (workspace_id, snapshot_date desc);
create index on liabilities (workspace_id, next_due_date) where status in ('active','current','overdue');
create index on goals (workspace_id, status) where archived_at is null;
```

## 13. Row Level Security

**Toda tabela deste documento tem RLS habilitado.** Nenhuma exceção.

### Funções auxiliares (schema `app`, `security definer`, `stable`)

```sql
create schema if not exists app;

create function app.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active');
$$;

create function app.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'owner');
$$;

create function app.has_permission(ws uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
      and m.status = 'active'
      and (m.role = 'owner'
           or coalesce((m.permissions ->> perm)::boolean,
                (select rp.granted from role_permissions rp
                  where rp.role = m.role and rp.permission = perm),
                false)));
$$;
```

A checagem é feita **a cada query** → revogação tem efeito imediato
(nenhuma autorização é embutida no JWT).

### Padrão de policies

```sql
-- Exemplo: transactions
alter table transactions enable row level security;

create policy sel on transactions for select
  using (app.is_member(workspace_id) and deleted_at is null);

create policy ins on transactions for insert
  with check (app.is_member(workspace_id) and created_by = auth.uid());

create policy upd on transactions for update
  using (app.is_member(workspace_id))
  with check (app.is_member(workspace_id));  -- + trigger imutabiliza workspace_id

create policy del on transactions for delete
  using (app.has_permission(workspace_id, 'delete_transactions'));
```

Especializações:
- `workspaces`: select para membros; update/delete só owner; insert com
  `owner_id = auth.uid()`.
- `workspace_members`: select para membros; insert/update/delete só owner
  (aceite de convite via função `accept_invitation(token)` `security definer`
  que valida hash + validade + e-mail).
- `workspace_invitations`: gestão só owner; aceite via função.
- `categories`, `goals`, `assets`, `investments`, `liabilities`,
  `business_projects`: escrita exige `app.has_permission(ws, 'edit_…')`.
- `payment_instructions`: select mascarado via view; select completo exige
  `view_full_payment_data` (owner sempre tem) e registra auditoria via RPC.
- `audit_logs`: select só owner; insert via função; sem update/delete.
- `ai_conversations`/`ai_messages`/`ai_tool_calls`: **isolamento por usuário**
  — `user_id = auth.uid()` **e** `app.is_member(workspace_id)` (conversas de
  um usuário não são visíveis a outro, nem ao owner).
- `net_worth_snapshots`, `alerts`: select membros; escrita via funções.

### Anti-adulteração de `workspace_id`

1. Policies `with check` exigem membership no `workspace_id` de destino;
2. Trigger `before update` rejeita mudança de `workspace_id` em qualquer
   tabela financeira;
3. Data-access layer sempre deriva `workspace_id` da sessão/rota validada,
   nunca do body do request.

## 14. Views e funções de agregação (cálculo no banco)

- `account_balances` — saldo por conta.
- `monthly_cashflow(workspace, month)` — previsto × realizado por natureza.
- `income_statement(workspace, period)` — bruto, descontos, líquido.
- `rule_50_20_30(workspace, period)` — percentuais e classificação.
- `category_spend(workspace, period)` — realizado × limite por categoria.
- `net_worth_current(workspace)` — bruto, passivos, líquido.
- `project_financials` — custos, receitas, resultado, margem, ROI por projeto.
- `goal_progress(goal_id)` — atual, esperado, ritmo, necessidade mensal.
- `upcoming_payments(workspace, horizon)` — vencimentos próximos.
- `generate_series_transactions(series, until)` — materialização idempotente.
- `recompute_alerts(workspace, period)` — alertas idempotentes.
- `create_net_worth_snapshot(workspace, date)` — snapshot idempotente.

Snapshots existem **somente para histórico**; valores correntes vêm sempre
das agregações.

## 15. Seeds

`supabase/seed.sql`: 16 categorias padrão de despesa (com ícone/cor), grupos
de investimento, catálogo `role_permissions`, presets de categorias de custo
de projeto (construção, veículos). Categorias padrão são copiadas para cada
workspace novo pela função `bootstrap_workspace(user_id)` (chamada no
primeiro login via trigger/onboarding).
