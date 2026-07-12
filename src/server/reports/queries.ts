import { createClient } from "@/lib/supabase/server";

export type MonthlySeriesRow = {
  month: string;
  netIncomeActual: string;
  expensesActual: string;
  financingActual: string;
  contributionsActual: string;
  debtPaymentsActual: string;
  freeCash: string;
};

export type CategorySpendRow = {
  categoryId: string;
  categoryName: string;
  plannedTotal: string;
  actualTotal: string;
};

export type IncomeStatement = {
  grossPlanned: string;
  deductionsPlanned: string;
  netPlanned: string;
  grossActual: string;
  deductionsActual: string;
  netActual: string;
};

export async function getMonthlySeries(
  workspaceId: string,
  from: string,
  to: string
): Promise<MonthlySeriesRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("monthly_series", {
    p_workspace: workspaceId,
    p_from: from,
    p_to: to,
  });
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
    month: String(row.month).slice(0, 7),
    netIncomeActual: String(row.net_income_actual),
    expensesActual: String(row.expenses_actual),
    financingActual: String(row.financing_actual),
    contributionsActual: String(row.contributions_actual),
    debtPaymentsActual: String(row.debt_payments_actual),
    freeCash: String(row.free_cash),
  }));
}

export async function getCategorySpend(
  workspaceId: string,
  from: string,
  to: string
): Promise<CategorySpendRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("category_spend", {
    p_workspace: workspaceId,
    p_from: from,
    p_to: to,
  });
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
    categoryId: String(row.category_id),
    categoryName: String(row.category_name),
    plannedTotal: String(row.planned_total),
    actualTotal: String(row.actual_total),
  }));
}

export async function getIncomeStatement(
  workspaceId: string,
  from: string,
  to: string
): Promise<IncomeStatement | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("income_statement", {
    p_workspace: workspaceId,
    p_from: from,
    p_to: to,
  });
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  return {
    grossPlanned: String(row.gross_planned),
    deductionsPlanned: String(row.deductions_planned),
    netPlanned: String(row.net_planned),
    grossActual: String(row.gross_actual),
    deductionsActual: String(row.deductions_actual),
    netActual: String(row.net_actual),
  };
}
