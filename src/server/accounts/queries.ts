import { createClient } from "@/lib/supabase/server";
import type { AccountType } from "@/lib/validation/finance";

export type FinancialAccount = {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  initialBalance: string;
  creditLimit: string | null;
  color: string | null;
  icon: string | null;
  note: string | null;
  archivedAt: string | null;
};

export async function getAccounts(
  workspaceId: string
): Promise<FinancialAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_accounts")
    .select(
      "id, name, type, institution, initial_balance, credit_limit, color, icon, note, archived_at"
    )
    .eq("workspace_id", workspaceId)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    institution: row.institution,
    initialBalance: String(row.initial_balance),
    creditLimit: row.credit_limit === null ? null : String(row.credit_limit),
    color: row.color,
    icon: row.icon,
    note: row.note,
    archivedAt: row.archived_at,
  }));
}
