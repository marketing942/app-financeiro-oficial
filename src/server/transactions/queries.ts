import { createClient } from "@/lib/supabase/server";
import type { IncomeClass, TransactionStatus } from "@/lib/finance/labels";

export type TransactionRow = {
  id: string;
  nature: string;
  description: string;
  status: TransactionStatus;
  plannedAmount: string | null;
  actualAmount: string | null;
  grossPlanned: string | null;
  netPlanned: string | null;
  grossActual: string | null;
  netActual: string | null;
  dueDate: string | null;
  realizedDate: string | null;
  competenceMonth: string;
  incomeClass: IncomeClass | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  subcategoryName: string | null;
  accountId: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  seriesId: string | null;
  paymentInstructionId: string | null;
  note: string | null;
};

type RawRow = Record<string, unknown> & {
  category: { name: string; icon: string | null; color: string | null } | null;
  subcategory: { name: string } | null;
};

function mapRow(row: RawRow): TransactionRow {
  const asString = (key: string) =>
    row[key] === null || row[key] === undefined ? null : String(row[key]);
  return {
    id: String(row.id),
    nature: String(row.nature),
    description: String(row.description),
    status: row.status as TransactionStatus,
    plannedAmount: asString("planned_amount"),
    actualAmount: asString("actual_amount"),
    grossPlanned: asString("gross_amount_planned"),
    netPlanned: asString("net_amount_planned"),
    grossActual: asString("gross_amount_actual"),
    netActual: asString("net_amount_actual"),
    dueDate: asString("due_date"),
    realizedDate: asString("realized_date"),
    competenceMonth: String(row.competence_month),
    incomeClass: (row.income_class as IncomeClass) ?? null,
    categoryId: asString("category_id"),
    categoryName: row.category?.name ?? null,
    categoryIcon: row.category?.icon ?? null,
    categoryColor: row.category?.color ?? null,
    subcategoryName: row.subcategory?.name ?? null,
    accountId: asString("account_id"),
    installmentNumber: (row.installment_number as number) ?? null,
    installmentCount: (row.installment_count as number) ?? null,
    seriesId: asString("series_id"),
    paymentInstructionId: asString("payment_instruction_id"),
    note: asString("note"),
  };
}

const SELECT_COLUMNS = `id, nature, description, status, planned_amount,
  actual_amount, gross_amount_planned, net_amount_planned,
  gross_amount_actual, net_amount_actual, due_date, realized_date,
  competence_month, income_class, category_id, account_id,
  installment_number, installment_count, series_id, payment_instruction_id,
  note, category:categories(name, icon, color), subcategory:subcategories(name)`;

// monthISO: "YYYY-MM"
export async function listTransactionsByMonth(
  workspaceId: string,
  monthISO: string,
  natures: string[]
): Promise<TransactionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(SELECT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("competence_month", `${monthISO}-01`)
    .in("nature", natures)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return (data as unknown as RawRow[]).map(mapRow);
}

export type IncomeStatement = {
  grossPlanned: string;
  deductionsPlanned: string;
  netPlanned: string;
  grossActual: string;
  deductionsActual: string;
  netActual: string;
};

export async function getIncomeStatement(
  workspaceId: string,
  monthISO: string
): Promise<IncomeStatement> {
  const supabase = await createClient();
  const from = `${monthISO}-01`;
  const { data } = await supabase.rpc("income_statement", {
    p_workspace: workspaceId,
    p_from: from,
    p_to: from,
  });

  const row = (data as Record<string, unknown>[] | null)?.[0];
  const value = (key: string) => String(row?.[key] ?? "0");
  return {
    grossPlanned: value("gross_planned"),
    deductionsPlanned: value("deductions_planned"),
    netPlanned: value("net_planned"),
    grossActual: value("gross_actual"),
    deductionsActual: value("deductions_actual"),
    netActual: value("net_actual"),
  };
}

export type CashflowByNature = Record<
  string,
  { planned: string; actual: string }
>;

export async function getMonthlyCashflow(
  workspaceId: string,
  monthISO: string
): Promise<CashflowByNature> {
  const supabase = await createClient();
  const from = `${monthISO}-01`;
  const { data } = await supabase.rpc("monthly_cashflow", {
    p_workspace: workspaceId,
    p_from: from,
    p_to: from,
  });

  const result: CashflowByNature = {};
  for (const row of (data as Record<string, unknown>[] | null) ?? []) {
    result[String(row.nature)] = {
      planned: String(row.planned_total ?? "0"),
      actual: String(row.actual_total ?? "0"),
    };
  }
  return result;
}

export type MaskedPaymentInstruction = {
  id: string;
  method: string | null;
  payee: string | null;
  pixKeyMasked: string | null;
  bankName: string | null;
  digitableLineMasked: string | null;
};

export async function getMaskedInstructions(
  ids: string[]
): Promise<Map<string, MaskedPaymentInstruction>> {
  const map = new Map<string, MaskedPaymentInstruction>();
  if (ids.length === 0) return map;

  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_instructions_masked")
    .select(
      "id, method, payee, pix_key_masked, bank_name, digitable_line_masked"
    )
    .in("id", ids);

  for (const row of data ?? []) {
    map.set(row.id, {
      id: row.id,
      method: row.method,
      payee: row.payee,
      pixKeyMasked: row.pix_key_masked,
      bankName: row.bank_name,
      digitableLineMasked: row.digitable_line_masked,
    });
  }
  return map;
}
