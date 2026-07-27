import { createClient } from "@/lib/supabase/server";
import type {
  Investment,
  InvestmentGroup,
  ReserveSummary,
} from "@/lib/finance/investments";

export type { Investment, InvestmentGroup, ReserveSummary };

export async function listInvestments(
  workspaceId: string
): Promise<Investment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investments")
    .select(
      "id, investment_group, subgroup, name, description, initial_amount, current_balance, target_amount, account_id, archived_at"
    )
    .eq("workspace_id", workspaceId)
    .order("name");

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    group: row.investment_group as InvestmentGroup,
    subgroup: row.subgroup,
    name: row.name,
    description: row.description,
    initialAmount: String(row.initial_amount),
    currentBalance: String(row.current_balance),
    targetAmount: row.target_amount === null ? null : String(row.target_amount),
    accountId: row.account_id,
    archivedAt: row.archived_at,
  }));
}

export type InvestmentYield = {
  id: string;
  investmentId: string;
  investmentName: string;
  competenceMonth: string;
  amount: string;
  note: string | null;
};

// monthISO: "YYYY-MM"
export async function listYieldsByMonth(
  workspaceId: string,
  monthISO: string
): Promise<InvestmentYield[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("investment_yields")
    .select("id, investment_id, competence_month, amount, note, investment:investments(name)")
    .eq("workspace_id", workspaceId)
    .eq("competence_month", `${monthISO}-01`)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    investmentId: String(row.investment_id),
    investmentName:
      (row.investment as { name?: string } | null)?.name ?? "Investimento",
    competenceMonth: String(row.competence_month),
    amount: String(row.amount),
    note: (row.note as string | null) ?? null,
  }));
}

export async function getYieldTotal(
  workspaceId: string,
  from: string,
  to: string
): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("investment_yield_total", {
    p_workspace: workspaceId,
    p_from: from,
    p_to: to,
  });
  return String(data ?? "0");
}

export async function getReserveSummary(
  workspaceId: string
): Promise<ReserveSummary | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("emergency_reserve_summary", {
    p_workspace: workspaceId,
  });
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  return {
    targetMonths: (row.target_months as number) ?? null,
    manualTarget: row.manual_target === null ? null : String(row.manual_target),
    essentialMonthlyAvg: String(row.essential_monthly_avg ?? "0"),
    computedTarget: String(row.computed_target ?? "0"),
    effectiveTarget: String(row.effective_target ?? "0"),
    currentBalance: String(row.current_balance ?? "0"),
    percent: row.percent === null ? null : String(row.percent),
  };
}
