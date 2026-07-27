-- Phase 16: ao excluir "este e os próximos em aberto" de uma recorrência, a
-- ocorrência escolhida deve sair MESMO se já estiver realizada/paga — é uma
-- ação explícita do usuário sobre aquele lançamento, não uma cascata. As
-- demais ocorrências já realizadas (de outros meses) continuam preservadas.

create or replace function public.soft_delete_series_from(p_transaction_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  tx transactions%rowtype;
begin
  select * into tx from transactions
   where id = p_transaction_id and deleted_at is null
   for update;
  if not found then
    return false;
  end if;
  if not app.has_permission(tx.workspace_id, 'delete_transactions') then
    raise exception 'not_authorized';
  end if;

  -- Sem série: exclusão simples desta ocorrência (qualquer status).
  if tx.series_id is null then
    update transactions
       set deleted_at = now(), updated_by = auth.uid()
     where id = p_transaction_id;
    perform app.log_audit(tx.workspace_id, 'transaction.deleted',
      'transaction', p_transaction_id,
      'Lançamento "' || tx.description || '" excluído (exclusão lógica)');
    return true;
  end if;

  -- Encerra a série (não gera novas ocorrências no cron nem manualmente).
  update transaction_series
     set deleted_at = now(), updated_by = auth.uid()
   where id = tx.series_id
     and workspace_id = tx.workspace_id
     and deleted_at is null;

  -- Exclui a própria ocorrência escolhida, independentemente do status.
  update transactions
     set deleted_at = now(), updated_by = auth.uid()
   where id = p_transaction_id
     and deleted_at is null;

  -- Exclui as próximas ainda em aberto (a partir do vencimento desta). As
  -- realizadas/parciais de OUTROS meses permanecem intactas.
  update transactions
     set deleted_at = now(), updated_by = auth.uid()
   where series_id = tx.series_id
     and workspace_id = tx.workspace_id
     and deleted_at is null
     and due_date >= tx.due_date
     and status in ('planned', 'pending', 'overdue');

  perform app.log_audit(tx.workspace_id, 'series.deleted_from',
    'transaction_series', tx.series_id,
    'Série encerrada a partir de ' || to_char(tx.due_date, 'DD/MM/YYYY')
    || ' (lançamento escolhido e próximos em aberto removidos)');

  return true;
end;
$$;
