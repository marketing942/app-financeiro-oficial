"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolvePermission } from "@/lib/permissions";
import { moneySchema, nonNegativeMoneySchema } from "@/lib/validation/finance";
import { RECURRENCE_OPTIONS } from "@/lib/validation/transactions";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

type ActionResult = { error: string } | { success: true };

const investmentSchema = z.object({
  group: z.enum([
    "real_estate",
    "long_term",
    "emergency_opportunity",
    "future_projects",
  ]),
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  subgroup: z.string().trim().max(80).optional().or(z.literal("")),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  initialAmount: nonNegativeMoneySchema.default("0"),
  targetAmount: nonNegativeMoneySchema.optional().or(z.literal("")),
  accountId: z.string().uuid().optional().or(z.literal("")),
});

const investmentUpdateSchema = investmentSchema.extend({
  investmentId: z.string().uuid(),
});

const contributionSchema = z.object({
  investmentId: z.string().uuid(),
  amount: nonNegativeMoneySchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  accountId: z.string().uuid().optional().or(z.literal("")),
  realizedNow: z.boolean().default(false),
  // `monthly` mantido por compatibilidade; `recurrence` generaliza para
  // única, frequências e parcelada — igual ao lançamento de despesa.
  monthly: z.boolean().default(false),
  recurrence: z.enum(RECURRENCE_OPTIONS).default("none"),
  installmentCount: z.coerce.number().int().min(2).max(480).optional(),
});

const reserveSettingsSchema = z.object({
  targetMonths: z.coerce.number().int().min(1).max(60).optional(),
  manualTarget: moneySchema.optional().or(z.literal("")),
  essentialCategoryIds: z.array(z.string().uuid()).default([]),
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

export async function createInvestment(input: unknown): Promise<ActionResult> {
  const parsed = investmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (
    !ctx ||
    !resolvePermission(
      ctx.workspace.role,
      ctx.workspace.permissions,
      "edit_investments"
    )
  ) {
    return { error: "Você não tem permissão para gerenciar investimentos." };
  }

  const d = parsed.data;
  const { data, error } = await ctx.supabase
    .from("investments")
    .insert({
      workspace_id: ctx.workspace.id,
      investment_group: d.group,
      name: d.name,
      subgroup: d.subgroup || null,
      description: d.description || null,
      initial_amount: d.initialAmount,
      // Saldo parte do valor inicial; o trigger recomputa a cada aporte.
      current_balance: d.initialAmount,
      target_amount: d.targetAmount || null,
      account_id: d.accountId || null,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "investment.created",
    entity_type: "investment",
    entity_id: data.id,
    summary: `Investimento "${d.name}" criado`,
  });

  revalidatePath("/investimentos");
  return { success: true };
}

export async function updateInvestment(input: unknown): Promise<ActionResult> {
  const parsed = investmentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (
    !ctx ||
    !resolvePermission(
      ctx.workspace.role,
      ctx.workspace.permissions,
      "edit_investments"
    )
  ) {
    return { error: "Você não tem permissão para gerenciar investimentos." };
  }

  const d = parsed.data;
  const { data, error } = await ctx.supabase
    .from("investments")
    .update({
      investment_group: d.group,
      name: d.name,
      subgroup: d.subgroup || null,
      description: d.description || null,
      target_amount: d.targetAmount || null,
      account_id: d.accountId || null,
      updated_by: ctx.user.id,
    })
    .eq("id", d.investmentId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "investment.updated",
    entity_type: "investment",
    entity_id: d.investmentId,
    summary: `Investimento "${d.name}" atualizado`,
  });

  revalidatePath("/investimentos");
  return { success: true };
}

export async function setInvestmentArchived(
  input: { investmentId: string },
  archived: boolean
): Promise<ActionResult> {
  const ctx = await requireContext();
  if (
    !ctx ||
    !resolvePermission(
      ctx.workspace.role,
      ctx.workspace.permissions,
      "edit_investments"
    )
  ) {
    return { error: "Você não tem permissão para gerenciar investimentos." };
  }

  const { data, error } = await ctx.supabase
    .from("investments")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      updated_by: ctx.user.id,
    })
    .eq("id", input.investmentId)
    .eq("workspace_id", ctx.workspace.id)
    .select("name")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: archived ? "investment.archived" : "investment.unarchived",
    entity_type: "investment",
    entity_id: input.investmentId,
    summary: `Investimento "${data.name}" ${archived ? "arquivado" : "reativado"}`,
  });

  revalidatePath("/investimentos");
  return { success: true };
}

// Aporte: transação de natureza investment_contribution (o trigger cria o
// vínculo 1:1 e recomputa o saldo). Mensal → série recorrente.
export async function createContribution(
  input: unknown
): Promise<ActionResult> {
  const parsed = contributionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const d = parsed.data;

  const { data: investment } = await ctx.supabase
    .from("investments")
    .select("name")
    .eq("id", d.investmentId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!investment) return { error: GENERIC_ERROR };

  // `monthly` legado vira recorrência mensal; senão vale o `recurrence`.
  const recurrence =
    d.recurrence !== "none" ? d.recurrence : d.monthly ? "monthly" : "none";
  const isInstallment = recurrence === "installment";
  if (isInstallment && !d.installmentCount) {
    return { error: "Informe o número de parcelas." };
  }

  if (recurrence !== "none") {
    const { data: series, error } = await ctx.supabase
      .from("transaction_series")
      .insert({
        workspace_id: ctx.workspace.id,
        kind: isInstallment ? "installment" : "recurring",
        nature: "investment_contribution",
        description: `Aporte — ${investment.name}`,
        frequency: isInstallment ? "monthly" : recurrence,
        planned_amount: isInstallment ? null : d.amount,
        total_amount: isInstallment ? d.amount : null,
        installment_count: isInstallment ? d.installmentCount : null,
        first_due_date: d.date,
        account_id: d.accountId || null,
        investment_id: d.investmentId,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error || !series) return { error: GENERIC_ERROR };

    const horizon = new Date(`${d.date}T12:00:00Z`);
    horizon.setUTCMonth(
      horizon.getUTCMonth() + (isInstallment ? (d.installmentCount ?? 1) : 12)
    );
    await ctx.supabase.rpc("generate_series_transactions", {
      p_series_id: series.id,
      p_until: horizon.toISOString().slice(0, 10),
    });
  } else {
    const { error } = await ctx.supabase.from("transactions").insert({
      workspace_id: ctx.workspace.id,
      nature: "investment_contribution",
      description: `Aporte — ${investment.name}`,
      account_id: d.accountId || null,
      investment_id: d.investmentId,
      planned_amount: d.amount,
      actual_amount: d.realizedNow ? d.amount : null,
      competence_month: `${d.date.slice(0, 7)}-01`,
      due_date: d.date,
      realized_date: d.realizedNow ? d.date : null,
      status: d.realizedNow ? "realized" : "planned",
      created_by: ctx.user.id,
    });
    if (error) return { error: GENERIC_ERROR };
  }

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "contribution.created",
    entity_type: "investment",
    entity_id: d.investmentId,
    summary: `Aporte ${recurrence !== "none" ? "programado " : ""}registrado em "${investment.name}"`,
  });

  revalidatePath("/investimentos");
  revalidatePath("/receitas");
  revalidatePath("/despesas");
  return { success: true };
}

export async function updateReserveSettings(
  input: unknown
): Promise<ActionResult> {
  const parsed = reserveSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (!ctx || ctx.workspace.role !== "owner") {
    return { error: "Apenas o proprietário configura a reserva." };
  }

  const { error } = await ctx.supabase
    .from("workspace_settings")
    .update({
      reserve_target_months: parsed.data.targetMonths ?? null,
      reserve_manual_target: parsed.data.manualTarget || null,
      essential_category_ids: parsed.data.essentialCategoryIds,
    })
    .eq("workspace_id", ctx.workspace.id);

  if (error) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "reserve.settings_updated",
    entity_type: "workspace_settings",
    entity_id: ctx.workspace.id,
    summary: "Configurações da reserva de emergência atualizadas",
  });

  revalidatePath("/investimentos");
  return { success: true };
}
