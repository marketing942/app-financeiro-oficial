-- Phase 10: Nylo (AI assistant). Conversations are isolated per user AND
-- workspace (not even the owner reads someone else's chat). Usage/cost is
-- logged per call and is the base for rate limiting. Nylo never writes
-- finances: drafts are confirmed by a human through the normal endpoints.

create type ai_role as enum ('user', 'assistant', 'system', 'tool');

create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  title text,
  archived_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_conversations_user_idx
  on ai_conversations (user_id, workspace_id, updated_at desc);

create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role ai_role not null,
  content text not null default '',
  content_json jsonb,
  token_count int,
  created_at timestamptz not null default now()
);

create index ai_messages_conversation_idx
  on ai_messages (conversation_id, created_at);

create table ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references ai_messages (id) on delete set null,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  tool_name text not null,
  arguments jsonb,
  result_summary text,
  status text not null default 'ok' check (status in ('ok', 'denied', 'error')),
  duration_ms int,
  created_at timestamptz not null default now()
);

create index ai_tool_calls_ws_idx on ai_tool_calls (workspace_id, created_at);

create table ai_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references ai_messages (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  conversation_id uuid references ai_conversations (id) on delete set null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);

create index ai_usage_logs_ws_idx on ai_usage_logs (workspace_id, created_at);
create index ai_usage_logs_user_idx on ai_usage_logs (user_id, created_at);

create trigger set_updated_at before update on ai_conversations
  for each row execute function app.set_updated_at();

-- Retenção: expires_at definido na criação a partir da configuração.
create function app.set_conversation_expiry()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  days int;
begin
  select ws.nylo_retention_days into days
    from workspace_settings ws
   where ws.workspace_id = new.workspace_id;
  new.expires_at := now() + make_interval(days => coalesce(days, 90));
  return new;
end;
$$;

create trigger on_conversation_created
  before insert on ai_conversations
  for each row execute function app.set_conversation_expiry();

-- Cron (service_role): remove conversas expiradas.
create function public.purge_expired_ai_conversations()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  removed int;
begin
  delete from ai_conversations where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_ai_conversations()
  from public, anon, authenticated;

-- Rate limiting (contagens cruzam usuários → SECURITY DEFINER, mas só
-- devolve números agregados do próprio workspace do membro).
create function public.nylo_rate_status(p_workspace uuid)
returns table (
  user_messages_today int,
  workspace_messages_month int,
  monthly_limit int
)
language sql stable security definer
set search_path = public
as $$
  select
    (select count(*)::int from ai_usage_logs u
      where u.workspace_id = p_workspace
        and u.user_id = auth.uid()
        and u.created_at >= date_trunc('day', now())),
    (select count(*)::int from ai_usage_logs u
      where u.workspace_id = p_workspace
        and u.created_at >= date_trunc('month', now())),
    (select ws.nylo_monthly_message_limit from workspace_settings ws
      where ws.workspace_id = p_workspace)
  where app.is_member(p_workspace);
$$;

grant execute on function public.nylo_rate_status(uuid) to authenticated;

-- ── Views de apoio (Nylo agora; Dashboard na Fase 11) ────────────────────

create function public.upcoming_payments(
  p_workspace uuid,
  p_days int default 30
)
returns table (
  transaction_id uuid,
  description text,
  nature transaction_nature,
  category_name text,
  due_date date,
  amount numeric(14,2),
  status transaction_status
)
language sql stable
as $$
  select t.id, t.description, t.nature, c.name,
         t.due_date,
         coalesce(t.planned_amount, t.actual_amount),
         t.status
    from transactions t
    left join categories c on c.id = t.category_id
   where t.workspace_id = p_workspace
     and app.is_member(t.workspace_id)
     and t.deleted_at is null
     and t.status in ('planned', 'pending', 'overdue')
     and t.due_date is not null
     and t.due_date <= current_date + p_days
   order by t.due_date
   limit 100;
$$;

grant execute on function public.upcoming_payments(uuid, int) to authenticated;

create function public.category_spend(
  p_workspace uuid,
  p_from date,
  p_to date
)
returns table (
  category_id uuid,
  category_name text,
  planned_total numeric(14,2),
  actual_total numeric(14,2)
)
language sql stable
as $$
  select c.id, c.name,
         coalesce(sum(t.planned_amount) filter (
           where t.status not in ('canceled', 'no_demand')), 0)::numeric(14,2),
         coalesce(sum(t.actual_amount) filter (
           where t.status in ('realized', 'partially_realized')), 0)::numeric(14,2)
    from transactions t
    join categories c on c.id = t.category_id
   where t.workspace_id = p_workspace
     and app.is_member(t.workspace_id)
     and t.deleted_at is null
     and t.nature in ('consumer_expense', 'consumer_financing')
     and t.competence_month between date_trunc('month', p_from)::date
                                and date_trunc('month', p_to)::date
   group by c.id, c.name
   order by 4 desc, 3 desc
   limit 100;
$$;

grant execute on function public.category_spend(uuid, date, date) to authenticated;

-- ── Row Level Security: isolamento por usuário E workspace ──────────────

alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;
alter table ai_tool_calls enable row level security;
alter table ai_feedback enable row level security;
alter table ai_usage_logs enable row level security;

create policy conv_all on ai_conversations for all
  using (user_id = auth.uid() and app.is_member(workspace_id))
  with check (user_id = auth.uid() and app.is_member(workspace_id));

-- Mensagem só em conversa PRÓPRIA (impede plantar mensagem em chat alheio).
create policy msg_all on ai_messages for all
  using (user_id = auth.uid() and app.is_member(workspace_id))
  with check (user_id = auth.uid() and app.is_member(workspace_id)
              and exists (select 1 from ai_conversations c
                           where c.id = conversation_id
                             and c.user_id = auth.uid()));

create policy toolcall_select on ai_tool_calls for select
  using (user_id = auth.uid() and app.is_member(workspace_id));
create policy toolcall_insert on ai_tool_calls for insert
  with check (user_id = auth.uid() and app.is_member(workspace_id));

create policy feedback_all on ai_feedback for all
  using (user_id = auth.uid() and app.is_member(workspace_id))
  with check (user_id = auth.uid() and app.is_member(workspace_id));

create policy usage_select on ai_usage_logs for select
  using (user_id = auth.uid() and app.is_member(workspace_id));
create policy usage_insert on ai_usage_logs for insert
  with check (user_id = auth.uid() and app.is_member(workspace_id));

revoke all on ai_conversations, ai_messages, ai_tool_calls, ai_feedback,
  ai_usage_logs from anon;
grant select, insert, update, delete on ai_conversations to authenticated;
grant select, insert on ai_messages to authenticated;
grant select, insert on ai_tool_calls to authenticated;
grant select, insert, update, delete on ai_feedback to authenticated;
grant select, insert on ai_usage_logs to authenticated;
