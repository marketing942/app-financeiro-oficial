import { createClient } from "@/lib/supabase/server";
import type {
  Asset,
  AssetStatus,
  AssetType,
  NetWorth,
  Snapshot,
} from "@/lib/finance/assets";

export type { Asset, NetWorth, Snapshot };

export async function listAssets(workspaceId: string): Promise<Asset[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .select(
      "id, name, type, purchase_value, purchase_date, current_value, valuation_date, valuation_source, ownership_percent, liability_id, status, sale_value, sale_date, note"
    )
    .eq("workspace_id", workspaceId)
    .order("status")
    .order("name");

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as AssetType,
    purchaseValue: String(row.purchase_value),
    purchaseDate: row.purchase_date,
    currentValue: String(row.current_value),
    valuationDate: row.valuation_date,
    valuationSource: row.valuation_source,
    ownershipPercent: String(row.ownership_percent),
    liabilityId: row.liability_id,
    status: row.status as AssetStatus,
    saleValue: row.sale_value === null ? null : String(row.sale_value),
    saleDate: row.sale_date,
    note: row.note,
  }));
}

export async function getNetWorth(
  workspaceId: string
): Promise<NetWorth | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("net_worth_current", {
    p_workspace: workspaceId,
  });
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  return {
    grossWorth: String(row.gross_worth ?? "0"),
    totalLiabilities: String(row.total_liabilities ?? "0"),
    netWorth: String(row.net_worth ?? "0"),
    investmentsTotal: String(row.investments_total ?? "0"),
    cashTotal: String(row.cash_total ?? "0"),
  };
}

export async function listSnapshots(
  workspaceId: string,
  limit = 12
): Promise<Snapshot[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("net_worth_snapshots")
    .select("id, snapshot_date, gross_worth, total_liabilities, net_worth")
    .eq("workspace_id", workspaceId)
    .order("snapshot_date", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    snapshotDate: row.snapshot_date,
    grossWorth: String(row.gross_worth),
    totalLiabilities: String(row.total_liabilities),
    netWorth: String(row.net_worth),
  }));
}
