-- Phase 20: corrige a exclusão de conta financeira.
-- A exclusão lógica era feita por UPDATE direto (set deleted_at), mas este
-- Postgres barra um UPDATE que torna a linha invisível pela política de SELECT
-- (que exige deleted_at nulo) — então "excluir conta" falhava. A exclusão
-- passa a ser feita por função auditada (mesmo padrão das demais entidades).

create function public.soft_delete_account(p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  a financial_accounts%rowtype;
begin
  select * into a from financial_accounts
   where id = p_id and deleted_at is null
   for update;
  if not found then
    return false;
  end if;
  if not app.is_owner(a.workspace_id) then
    raise exception 'not_authorized';
  end if;

  update financial_accounts
     set deleted_at = now(), updated_by = auth.uid()
   where id = p_id;

  perform app.log_audit(a.workspace_id, 'account.deleted',
    'financial_account', p_id,
    'Conta "' || a.name || '" excluída (exclusão lógica)');

  return true;
end;
$$;

grant execute on function public.soft_delete_account(uuid) to authenticated;
