"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolvePermission } from "@/lib/permissions";
import { nonNegativeMoneySchema } from "@/lib/validation/finance";
import type { PayoffSimulation } from "@/lib/finance/liabilities";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";
const PATHS = ["/dividas", "/financiamentos", "/despesas"];

type ActionResult = { error: string } | { success: true };

const liabilitySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(100),
  creditor: z.string().trim().max(100).optional().or(z.literal("")),
  purpose: z.enum([
    "personal_consumption",
    "investment",
    "commercial_project",
    "other",
  ]),
  originalAmount: nonNegativeMoneySchema,
  installmentCount: z.coerce.number().int().min(1).max(600).optional(),
  installmentAmount: nonNegativeMoneySchema.optional().or(z.literal("")),
  firstDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  createSchedule: z.boolean().default(false),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

const liabilityUpdateSchema = liabilitySchema
  .omit({ createSchedule: true, firstDueDate: true, originalAmount: true })
  .extend({ liabilityId: z.string().uuid() });

const paymentSchema = z.object({
  liabilityId: z.string().uuid(),
  amount: nonNegativeMoneySchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  accountId: z.string().uuid().optional().or(z.literal("")),
  realizedNow: z.boolean().default(true),
});

async function requireContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { active } = await getActiveWorkspace();
  if (!active) return null;
  return { supabase, user, workspace: active };
}

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
}

export async function createLiability(input: unknown): Promise<ActionResult> {
  const parsed = liabilitySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (
    !ctx ||
    !resolvePermission(
      ctx.workspace.role,
      ctx.workspace.permissions,
      "edit_liabilities"
    )
  ) {
    return { error: "Você não tem permissão para gerenciar dívidas." };
  }

  const d = parsed.data;
  const { data: liability, error } = await ctx.supabase
    .from("liabilities")
    .insert({
      workspace_id: ctx.workspace.id,
      name: d.name,
      creditor: d.creditor || null,
      purpose_classification: d.purpose,
      original_amount: d.originalAmount,
      current_balance: d.originalAmount,
      installment_count: d.installmentCount ?? null,
      installments_remaining: d.installmentCount ?? null,
      installment_amount: d.installmentAmount || null,
      start_date: d.firstDueDate || null,
      next_due_date: d.firstDueDate || null,
      note: d.note || null,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error || !liability) return { error: GENERIC_ERROR };

  // Cronograma de parcelas: série installment de debt_payment.
  if (
    d.createSchedule &&
    d.installmentCount &&
    d.installmentAmount &&
    d.firstDueDate
  ) {
    const cents =
      BigInt(d.installmentAmount.replace(".", "")) * BigInt(d.installmentCount);
    const total = `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;

    const { data: series } = await ctx.supabase
      .from("transaction_series")
      .insert({
        workspace_id: ctx.workspace.id,
        kind: "installment",
        nature: "debt_payment",
        description: `Parcela — ${d.name}`,
        frequency: "monthly",
        total_amount: total,
        installment_count: d.installmentCount,
        first_due_date: d.firstDueDate,
        purpose_classification: d.purpose,
        liability_id: liability.id,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();

    if (series) {
      const horizon = new Date(`${d.firstDueDate}T12:00:00Z`);
      horizon.setUTCMonth(horizon.getUTCMonth() + d.installmentCount);
      await ctx.supabase.rpc("generate_series_transactions", {
        p_series_id: series.id,
        p_until: horizon.toISOString().slice(0, 10),
      });
    }
  }

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "liability.created",
    entity_type: "liability",
    entity_id: liability.id,
    summary: `Dívida "${d.name}" criada`,
  });

  revalidateAll();
  return { success: true };
}

export async function updateLiability(input: unknown): Promise<ActionResult> {
  const parsed = liabilityUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (
    !ctx ||
    !resolvePermission(
      ctx.workspace.role,
      ctx.workspace.permissions,
      "edit_liabilities"
    )
  ) {
    return { error: "Você não tem permissão para gerenciar dívidas." };
  }

  const d = parsed.data;
  const { data, error } = await ctx.supabase
    .from("liabilities")
    .update({
      name: d.name,
      creditor: d.creditor || null,
      purpose_classification: d.purpose,
      installment_amount: d.installmentAmount || null,
      note: d.note || null,
      updated_by: ctx.user.id,
    })
    .eq("id", d.liabilityId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "liability.updated",
    entity_type: "liability",
    entity_id: d.liabilityId,
    summary: `Dívida "${d.name}" atualizada`,
  });

  revalidateAll();
  return { success: true };
}

// Pagamento avulso (amortização/quitação). Parcelas do cronograma são
// pagas pela própria página de Despesas/Financiamentos via markRealized.
export async function registerLiabilityPayment(
  input: unknown
): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const d = parsed.data;
  const { data: liability } = await ctx.supabase
    .from("liabilities")
    .select("name, purpose_classification")
    .eq("id", d.liabilityId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!liability) return { error: GENERIC_ERROR };

  const { error } = await ctx.supabase.from("transactions").insert({
    workspace_id: ctx.workspace.id,
    nature: "debt_payment",
    description: `Pagamento — ${liability.name}`,
    account_id: d.accountId || null,
    liability_id: d.liabilityId,
    purpose_classification: liability.purpose_classification,
    planned_amount: d.amount,
    actual_amount: d.realizedNow ? d.amount : null,
    competence_month: `${d.date.slice(0, 7)}-01`,
    due_date: d.date,
    realized_date: d.realizedNow ? d.date : null,
    status: d.realizedNow ? "realized" : "planned",
    created_by: ctx.user.id,
  });
  if (error) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "liability.payment_registered",
    entity_type: "liability",
    entity_id: d.liabilityId,
    summary: `Pagamento registrado em "${liability.name}"`,
  });

  revalidateAll();
  return { success: true };
}

export async function simulatePayoff(
  liabilityId: string,
  extraMonthly: string
): Promise<{ error: string } | { success: true; data: PayoffSimulation }> {
  const ctx = await requireContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const { data, error } = await ctx.supabase.rpc("simulate_liability_payoff", {
    p_liability: liabilityId,
    p_extra_monthly: extraMonthly || "0",
  });
  if (error) return { error: GENERIC_ERROR };

  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return { error: GENERIC_ERROR };

  return {
    success: true,
    data: {
      monthsRemaining: (row.months_remaining as number) ?? null,
      projectedFinish: (row.projected_finish as string) ?? null,
      monthlyPayment: String(row.monthly_payment ?? "0"),
      totalToPay: String(row.total_to_pay ?? "0"),
    },
  };
}
