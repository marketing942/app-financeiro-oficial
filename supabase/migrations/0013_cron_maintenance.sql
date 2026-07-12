-- Phase 13: cron maintenance. Aggregate functions check membership via
-- auth.uid(), so service-role jobs impersonate each workspace's OWNER
-- (transaction-scoped claims) instead of weakening the security model.

-- Fix: sob service_role (auth.uid() nulo), net_worth_current devolvia
-- zeros e o snapshot mensal gravaria valores errados. A recomputação por
-- impersonação do dono corrige o snapshot do cron.
create or replace function public.create_monthly_snapshots()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  ws record;
  total int := 0;
begin
  if auth.uid() is not null then
    raise exception 'not_authorized'; -- somente service_role/cron
  end if;

  for ws in select w.id, w.owner_id from workspaces w
             where w.deleted_at is null loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', ws.owner_id)::text, true);
    perform create_net_worth_snapshot(ws.id, current_date);
    total := total + 1;
  end loop;

  perform set_config('request.jwt.claims', '{}', true);
  return total;
end;
$$;

revoke all on function public.create_monthly_snapshots()
  from public, anon, authenticated;

-- Manutenção diária: atrasos, horizonte de recorrências, alertas de todos
-- os workspaces e expiração de conversas da Nylo.
create function public.run_daily_maintenance()
returns table (
  overdue_marked int,
  series_extended int,
  alerts_recomputed int,
  conversations_purged int
)
language plpgsql security definer
set search_path = public
as $$
declare
  ws record;
  s record;
  v_overdue int;
  v_series int := 0;
  v_alerts int := 0;
  v_purged int;
begin
  if auth.uid() is not null then
    raise exception 'not_authorized'; -- somente service_role/cron
  end if;

  v_overdue := mark_overdue_transactions();

  for s in select ts.id from transaction_series ts
            where ts.kind = 'recurring'
              and ts.deleted_at is null
              and (ts.end_date is null or ts.end_date >= current_date) loop
    perform generate_series_transactions(
      s.id, (current_date + interval '12 months')::date);
    v_series := v_series + 1;
  end loop;

  for ws in select w.id, w.owner_id from workspaces w
             where w.deleted_at is null loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', ws.owner_id)::text, true);
    v_alerts := v_alerts + recompute_alerts(ws.id);
  end loop;
  perform set_config('request.jwt.claims', '{}', true);

  v_purged := purge_expired_ai_conversations();

  return query select v_overdue, v_series, v_alerts, v_purged;
end;
$$;

revoke all on function public.run_daily_maintenance()
  from public, anon, authenticated;
