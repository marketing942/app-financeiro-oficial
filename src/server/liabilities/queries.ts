import { createClient } from "@/lib/supabase/server";
import type {
  Liability,
  LiabilityStatus,
  PurposeClassification,
} from "@/lib/finance/liabilities";

export type { Liability };

export async function listLiabilities(
  workspaceId: string,
  purpose?: PurposeClassification
): Promise<Liability[]> {
  const supabase = await createClient();
  let query = supabase
    .from("liabilities")
    .select(
      "id, name, creditor, purpose_classification, original_amount, current_balance, paid_amount, installment_count, installments_remaining, installment_amount, next_due_date, status, note"
    )
    .eq("workspace_id", workspaceId)
    .order("next_due_date", { ascending: true, nullsFirst: false })
    .order("name");

  if (purpose) query = query.eq("purpose_classification", purpose);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    creditor: row.creditor,
    purpose: row.purpose_classification as PurposeClassification,
    originalAmount: String(row.original_amount),
    currentBalance: String(row.current_balance),
    paidAmount: String(row.paid_amount),
    installmentCount: row.installment_count,
    installmentsRemaining: row.installments_remaining,
    installmentAmount:
      row.installment_amount === null ? null : String(row.installment_amount),
    nextDueDate: row.next_due_date,
    status: row.status as LiabilityStatus,
    note: row.note,
  }));
}
