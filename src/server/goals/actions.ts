"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolvePermission } from "@/lib/permissions";
import { nonNegativeMoneySchema } from "@/lib/validation/finance";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

type ActionResult = { error: string } | { success: true };

const GOAL_TYPES = [
  "income",
  "expense_limit",
  "contribution",
  "reserve",
  "investment",
  "project",
  "debt_payoff",
  "acquisition",
  "gross_worth",
  "liability_reduction",
  "net_worth",
  "custom",
] as const;

const goalSchema = z
  .object({
    name: z.string().trim().min(1, "Informe o nome.").max(100),
    type: z.enum(GOAL_TYPES),
    relatedEntityType: z
      .enum(["category", "investment", "liability", "project"])
      .optional()
      .or(z.literal("")),
    relatedEntityId: z.string().uuid().optional().or(z.literal("")),
    initialValue: nonNegativeMoneySchema.optional().or(z.literal("")),
    targetValue: nonNegativeMoneySchema,
    currentValueOverride: nonNegativeMoneySchema.optional().or(z.literal("")),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
    note: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine((d) => d.endDate > d.startDate, {
    message: "A data final deve ser depois da inicial.",
  })
  .refine((d) => !d.currentValueOverride || d.type === "custom", {
    message: "Valor manual só é permitido em metas personalizadas.",
  })
  .refine((d) => d.type !== "project" || d.relatedEntityId, {
    message: "Meta de projeto precisa de um projeto vinculado.",
  });

const goalUpdateSchema = z.object({
  goalId: z.string().uuid(),
});

async function requireGoalEditor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { active } = await getActiveWorkspace();
  if (!active) return null;
  if (!resolvePermission(active.role, active.permissions, "edit_goals")) {
    return null;
  }
  return { supabase, user, workspace: active };
}

export async function createGoal(input: unknown): Promise<ActionResult> {
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireGoalEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar metas." };
  }

  const d = parsed.data;
  const { data, error } = await ctx.supabase
    .from("goals")
    .insert({
      workspace_id: ctx.workspace.id,
      name: d.name,
      type: d.type,
      related_entity_type: d.relatedEntityId
        ? d.relatedEntityType || null
        : null,
      related_entity_id: d.relatedEntityId || null,
      initial_value: d.initialValue || "0",
      target_value: d.targetValue,
      current_value_override:
        d.type === "custom" && d.currentValueOverride
          ? d.currentValueOverride
          : null,
      start_date: d.startDate,
      end_date: d.endDate,
      note: d.note || null,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "goal.created",
    entity_type: "goal",
    entity_id: data.id,
    summary: `Meta "${d.name}" criada (alvo ${d.targetValue})`,
  });

  revalidatePath("/planejamento");
  return { success: true };
}

// Edição completa de meta (nome, tipo, prazo, alvo, vínculo). O progresso
// manual (só metas personalizadas) segue por updateGoalProgressValue.
export async function updateGoal(input: unknown): Promise<ActionResult> {
  // goalId validado à parte: goalSchema tem refines (não é objeto extensível).
  const idParsed = goalUpdateSchema.safeParse(input);
  const parsed = goalSchema.safeParse(input);
  if (!idParsed.success || !parsed.success) {
    return {
      error:
        parsed.success === false
          ? (parsed.error.issues[0]?.message ?? "Dados inválidos.")
          : "Dados inválidos.",
    };
  }
  const ctx = await requireGoalEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar metas." };
  }

  const d = parsed.data;
  const { goalId } = idParsed.data;
  const update: Record<string, unknown> = {
    name: d.name,
    type: d.type,
    related_entity_type: d.relatedEntityId ? d.relatedEntityType || null : null,
    related_entity_id: d.relatedEntityId || null,
    initial_value: d.initialValue || "0",
    target_value: d.targetValue,
    start_date: d.startDate,
    end_date: d.endDate,
    note: d.note || null,
    updated_by: ctx.user.id,
  };
  // Fora de metas personalizadas o override não pode existir (constraint no
  // banco) — zera ao trocar de tipo. Metas personalizadas mantêm o valor
  // manual, editável pelo fluxo próprio de progresso.
  if (d.type !== "custom") {
    update.current_value_override = null;
  }

  const { error, count } = await ctx.supabase
    .from("goals")
    .update(update, { count: "exact" })
    .eq("id", goalId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null);

  if (error || !count) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "goal.updated",
    entity_type: "goal",
    entity_id: goalId,
    summary: `Meta "${d.name}" editada (alvo ${d.targetValue})`,
  });

  revalidatePath("/planejamento");
  return { success: true };
}

export async function updateGoalProgressValue(
  input: unknown
): Promise<ActionResult> {
  const schema = goalUpdateSchema.extend({
    currentValueOverride: nonNegativeMoneySchema,
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireGoalEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar metas." };
  }

  // Override manual só existe para metas personalizadas — o banco garante.
  const { error, count } = await ctx.supabase
    .from("goals")
    .update(
      {
        current_value_override: parsed.data.currentValueOverride,
        updated_by: ctx.user.id,
      },
      { count: "exact" }
    )
    .eq("id", parsed.data.goalId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("type", "custom");

  if (error || !count) {
    return { error: "Só metas personalizadas aceitam valor manual." };
  }

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "goal.progress_updated",
    entity_type: "goal",
    entity_id: parsed.data.goalId,
    summary: `Progresso manual atualizado (${parsed.data.currentValueOverride})`,
  });

  revalidatePath("/planejamento");
  return { success: true };
}

export async function archiveGoal(input: unknown): Promise<ActionResult> {
  const parsed = goalUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };
  const ctx = await requireGoalEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar metas." };
  }

  const { error, count } = await ctx.supabase
    .from("goals")
    .update(
      { archived_at: new Date().toISOString(), updated_by: ctx.user.id },
      { count: "exact" }
    )
    .eq("id", parsed.data.goalId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null);

  if (error || !count) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "goal.archived",
    entity_type: "goal",
    entity_id: parsed.data.goalId,
    summary: "Meta arquivada",
  });

  revalidatePath("/planejamento");
  return { success: true };
}
