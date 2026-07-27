-- Phase 15: exclusões explícitas pedidas pelo usuário.
-- Categorias/subcategorias não têm exclusão lógica (só archived_at), então a
-- exclusão é definitiva e RECUSADA quando há lançamentos vinculados — nesse
-- caso o correto é arquivar (histórico é preservado, regra 9).
-- Investimentos usam exclusão lógica (deleted_at) para preservar histórico.
-- Snapshots patrimoniais não têm dependentes: exclusão definitiva.

-- ── Categorias ─────────────────────────────────────────────────────────────
create function public.delete_category(p_category_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  cat categories%rowtype;
begin
  select * into cat from categories where id = p_category_id;
  if not found then
    return false;
  end if;
  if not app.has_permission(cat.workspace_id, 'edit_categories') then
    raise exception 'not_authorized';
  end if;

  -- Em uso pela própria categoria ou por qualquer subcategoria dela?
  if exists (
    select 1 from transactions t
     where t.workspace_id = cat.workspace_id
       and (t.category_id = p_category_id
            or t.subcategory_id in (
              select s.id from subcategories s where s.category_id = p_category_id))
  ) then
    raise exception 'category_in_use';
  end if;

  delete from subcategories where category_id = p_category_id;
  delete from categories where id = p_category_id;

  perform app.log_audit(cat.workspace_id, 'category.deleted',
    'category', p_category_id,
    'Categoria "' || cat.name || '" excluída definitivamente');

  return true;
end;
$$;

grant execute on function public.delete_category(uuid) to authenticated;

-- ── Subcategorias ──────────────────────────────────────────────────────────
create function public.delete_subcategory(p_subcategory_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  sub subcategories%rowtype;
begin
  select * into sub from subcategories where id = p_subcategory_id;
  if not found then
    return false;
  end if;
  if not app.has_permission(sub.workspace_id, 'edit_categories') then
    raise exception 'not_authorized';
  end if;

  if exists (
    select 1 from transactions t
     where t.workspace_id = sub.workspace_id
       and t.subcategory_id = p_subcategory_id
  ) then
    raise exception 'subcategory_in_use';
  end if;

  delete from subcategories where id = p_subcategory_id;

  perform app.log_audit(sub.workspace_id, 'subcategory.deleted',
    'subcategory', p_subcategory_id,
    'Subcategoria "' || sub.name || '" excluída definitivamente');

  return true;
end;
$$;

grant execute on function public.delete_subcategory(uuid) to authenticated;

-- ── Investimentos (exclusão lógica) ────────────────────────────────────────
create function public.soft_delete_investment(p_investment_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  inv investments%rowtype;
begin
  select * into inv from investments
   where id = p_investment_id and deleted_at is null
   for update;
  if not found then
    return false;
  end if;
  if not app.has_permission(inv.workspace_id, 'edit_investments') then
    raise exception 'not_authorized';
  end if;

  update investments
     set deleted_at = now(), updated_by = auth.uid()
   where id = p_investment_id;

  perform app.log_audit(inv.workspace_id, 'investment.deleted',
    'investment', p_investment_id,
    'Investimento "' || inv.name || '" excluído (exclusão lógica)');

  return true;
end;
$$;

grant execute on function public.soft_delete_investment(uuid) to authenticated;

-- ── Snapshots patrimoniais (exclusão definitiva) ───────────────────────────
create function public.delete_net_worth_snapshot(p_snapshot_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  snap net_worth_snapshots%rowtype;
begin
  select * into snap from net_worth_snapshots where id = p_snapshot_id;
  if not found then
    return false;
  end if;
  if not app.has_permission(snap.workspace_id, 'edit_assets') then
    raise exception 'not_authorized';
  end if;

  delete from net_worth_snapshots where id = p_snapshot_id;

  perform app.log_audit(snap.workspace_id, 'net_worth.snapshot_deleted',
    'workspace', snap.workspace_id,
    'Snapshot patrimonial de ' || to_char(snap.snapshot_date, 'DD/MM/YYYY')
    || ' excluído');

  return true;
end;
$$;

grant execute on function public.delete_net_worth_snapshot(uuid) to authenticated;
