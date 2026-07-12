import { createClient } from "@/lib/supabase/server";
import type { ChartPayload } from "@/lib/ai/schemas";

export type DashboardSummary = {
  netIncomePlanned: string;
  netIncomeActual: string;
  expensesPlanned: string;
  expensesActual: string;
  financingActual: string;
  contributionsActual: string;
  debtPaymentsActual: string;
  outflowsPlanned: string;
  outflowsActual: string;
  balancePlanned: string;
  balanceActual: string;
  operatingBalance: string;
  freeCash: string;
};

export type Rule502030 = {
  netIncome: string;
  expenses: string;
  financing: string;
  investments: string;
  pctExpenses: string | null;
  pctFinancing: string | null;
  pctInvestments: string | null;
  expensesStatus: "within" | "above" | "no_base";
  financingStatus: "within" | "above" | "no_base";
  investmentsStatus: "at_or_above_minimum" | "below_minimum" | "no_base";
};

export type Alert = {
  id: string;
  ruleKey: string;
  severity: "info" | "attention" | "critical" | "success";
  title: string;
  body: string | null;
  amount: string | null;
  referenceDate: string;
  actionUrl: string | null;
  seenAt: string | null;
};

export type UpcomingPayment = {
  transactionId: string;
  description: string;
  categoryName: string | null;
  dueDate: string;
  amount: string;
  status: string;
};

export async function getDashboardSummary(
  workspaceId: string,
  from: string,
  to: string
): Promise<DashboardSummary | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("dashboard_summary", {
    p_workspace: workspaceId,
    p_from: from,
    p_to: to,
  });
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  return {
    netIncomePlanned: String(row.net_income_planned),
    netIncomeActual: String(row.net_income_actual),
    expensesPlanned: String(row.expenses_planned),
    expensesActual: String(row.expenses_actual),
    financingActual: String(row.financing_actual),
    contributionsActual: String(row.contributions_actual),
    debtPaymentsActual: String(row.debt_payments_actual),
    outflowsPlanned: String(row.outflows_planned),
    outflowsActual: String(row.outflows_actual),
    balancePlanned: String(row.balance_planned),
    balanceActual: String(row.balance_actual),
    operatingBalance: String(row.operating_balance),
    freeCash: String(row.free_cash),
  };
}

export async function getRule502030(
  workspaceId: string,
  from: string,
  to: string
): Promise<Rule502030 | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("rule_50_20_30", {
    p_workspace: workspaceId,
    p_from: from,
    p_to: to,
  });
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  return {
    netIncome: String(row.net_income),
    expenses: String(row.expenses),
    financing: String(row.financing),
    investments: String(row.investments),
    pctExpenses: row.pct_expenses === null ? null : String(row.pct_expenses),
    pctFinancing: row.pct_financing === null ? null : String(row.pct_financing),
    pctInvestments:
      row.pct_investments === null ? null : String(row.pct_investments),
    expensesStatus: row.expenses_status as Rule502030["expensesStatus"],
    financingStatus: row.financing_status as Rule502030["financingStatus"],
    investmentsStatus:
      row.investments_status as Rule502030["investmentsStatus"],
  };
}

export async function listAlerts(
  workspaceId: string,
  limit = 20
): Promise<Alert[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("alerts")
    .select(
      "id, rule_key, severity, title, body, amount, reference_date, action_url, seen_at"
    )
    .eq("workspace_id", workspaceId)
    .is("resolved_at", null)
    .order("severity", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => ({
    id: row.id,
    ruleKey: row.rule_key,
    severity: row.severity as Alert["severity"],
    title: row.title,
    body: row.body,
    amount: row.amount === null ? null : String(row.amount),
    referenceDate: row.reference_date,
    actionUrl: row.action_url,
    seenAt: row.seen_at,
  }));
}

export async function listUpcomingPayments(
  workspaceId: string,
  days = 15
): Promise<UpcomingPayment[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("upcoming_payments", {
    p_workspace: workspaceId,
    p_days: days,
  });
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
    transactionId: String(row.transaction_id),
    description: String(row.description),
    categoryName: (row.category_name as string | null) ?? null,
    dueDate: String(row.due_date),
    amount: String(row.amount),
    status: String(row.status),
  }));
}

export async function getExpenseDistributionChart(
  workspaceId: string,
  from: string,
  to: string
): Promise<ChartPayload | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("category_spend", {
    p_workspace: workspaceId,
    p_from: from,
    p_to: to,
  });
  const rows = (data as Record<string, unknown>[] | null) ?? [];
  const nonZero = rows.filter((r) => Number(r.actual_total) > 0).slice(0, 10);
  if (nonZero.length === 0) return null;
  return {
    kind: "distribuicao_despesas",
    title: "Distribuição de despesas (realizado)",
    points: nonZero.map((r) => ({
      label: String(r.category_name),
      values: { realizado: String(r.actual_total) },
    })),
  };
}

export async function getNetWorthEvolutionChart(
  workspaceId: string
): Promise<ChartPayload | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("net_worth_snapshots")
    .select("snapshot_date, gross_worth, total_liabilities, net_worth")
    .eq("workspace_id", workspaceId)
    .order("snapshot_date", { ascending: true })
    .limit(24);
  if (!data?.length) return null;
  return {
    kind: "evolucao_patrimonio",
    title: "Evolução do patrimônio",
    points: data.map((s) => ({
      label: String(s.snapshot_date).slice(0, 7),
      values: {
        bruto: String(s.gross_worth),
        passivos: String(s.total_liabilities),
        liquido: String(s.net_worth),
      },
    })),
  };
}
