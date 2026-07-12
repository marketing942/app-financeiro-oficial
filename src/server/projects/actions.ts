"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolvePermission } from "@/lib/permissions";
import { nonNegativeMoneySchema } from "@/lib/validation/finance";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

type ActionResult = { error: string } | { success: true };

const PROJECT_TYPES = [
  "construction_for_sale",
  "buy_and_renovate",
  "vehicle_trade",
  "land",
  "venture",
  "commercial",
  "other",
] as const;

const PROJECT_STATUSES = [
  "planning",
  "in_progress",
  "paused",
  "ready_for_sale",
  "sold",
  "completed",
  "canceled",
] as const;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

const projectSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(100),
  type: z.enum(PROJECT_TYPES),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  startDate: dateSchema.optional().or(z.literal("")),
  expectedEndDate: dateSchema.optional().or(z.literal("")),
  budget: nonNegativeMoneySchema.optional().or(z.literal("")),
  expectedSaleValue: nonNegativeMoneySchema.optional().or(z.literal("")),
});

const statusSchema = z.object({
  projectId: z.string().uuid(),
  status: z.enum(PROJECT_STATUSES),
});

const stageSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1, "Informe o nome da etapa.").max(100),
});

const stageStatusSchema = z.object({
  stageId: z.string().uuid(),
  status: z.enum(["pending", "in_progress", "done", "skipped"]),
});

const projectTxSchema = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(["cost", "income", "contribution"]),
  description: z.string().trim().min(1, "Descreva o lançamento.").max(200),
  amount: nonNegativeMoneySchema,
  date: dateSchema,
  accountId: z.string().uuid().optional().or(z.literal("")),
  costCategoryId: z.string().uuid().optional().or(z.literal("")),
  realizedNow: z.boolean().default(true),
});

async function requireProjectEditor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { active } = await getActiveWorkspace();
  if (!active) return null;
  if (!resolvePermission(active.role, active.permissions, "edit_projects")) {
    return null;
  }
  return { supabase, user, workspace: active };
}

export async function createProject(input: unknown): Promise<ActionResult> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireProjectEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar projetos." };
  }

  const d = parsed.data;
  const { data, error } = await ctx.supabase
    .from("business_projects")
    .insert({
      workspace_id: ctx.workspace.id,
      name: d.name,
      type: d.type,
      description: d.description || null,
      start_date: d.startDate || null,
      expected_end_date: d.expectedEndDate || null,
      budget: d.budget || null,
      expected_sale_value: d.expectedSaleValue || null,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "project.created",
    entity_type: "business_project",
    entity_id: data.id,
    summary: `Projeto "${d.name}" criado`,
  });

  revalidatePath("/projetos");
  return { success: true };
}

export async function updateProjectStatus(
  input: unknown
): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };
  const ctx = await requireProjectEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar projetos." };
  }

  const { error, count } = await ctx.supabase
    .from("business_projects")
    .update(
      { status: parsed.data.status, updated_by: ctx.user.id },
      { count: "exact" }
    )
    .eq("id", parsed.data.projectId)
    .eq("workspace_id", ctx.workspace.id);

  if (error || !count) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "project.status_changed",
    entity_type: "business_project",
    entity_id: parsed.data.projectId,
    summary: `Status do projeto alterado para ${parsed.data.status}`,
  });

  revalidatePath("/projetos");
  revalidatePath(`/projetos/${parsed.data.projectId}`);
  return { success: true };
}

export async function deleteProject(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ projectId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };
  const ctx = await requireProjectEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar projetos." };
  }

  const { data, error } = await ctx.supabase.rpc("soft_delete_project", {
    p_id: parsed.data.projectId,
  });
  if (error || !data) return { error: GENERIC_ERROR };

  revalidatePath("/projetos");
  return { success: true };
}

export async function addStage(input: unknown): Promise<ActionResult> {
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireProjectEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar projetos." };
  }

  const { data: last } = await ctx.supabase
    .from("project_stages")
    .select("sort_order")
    .eq("project_id", parsed.data.projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await ctx.supabase.from("project_stages").insert({
    workspace_id: ctx.workspace.id,
    project_id: parsed.data.projectId,
    name: parsed.data.name,
    sort_order: (last?.sort_order ?? 0) + 1,
  });

  if (error) return { error: GENERIC_ERROR };
  revalidatePath(`/projetos/${parsed.data.projectId}`);
  return { success: true };
}

export async function setStageStatus(input: unknown): Promise<ActionResult> {
  const parsed = stageStatusSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };
  const ctx = await requireProjectEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar projetos." };
  }

  const { data, error } = await ctx.supabase
    .from("project_stages")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.stageId)
    .eq("workspace_id", ctx.workspace.id)
    .select("project_id")
    .single();

  if (error || !data) return { error: GENERIC_ERROR };
  revalidatePath(`/projetos/${data.project_id}`);
  return { success: true };
}

// Custos, receitas e aportes do projeto entram na fonte única
// (transactions) com naturezas dedicadas — nunca nos agregados pessoais.
export async function addProjectTransaction(
  input: unknown
): Promise<ActionResult> {
  const parsed = projectTxSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireProjectEditor();
  if (!ctx) {
    return { error: "Você não tem permissão para gerenciar projetos." };
  }

  const d = parsed.data;
  const nature =
    d.kind === "cost"
      ? "project_cost"
      : d.kind === "income"
        ? "project_income"
        : "investment_contribution";

  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert({
      workspace_id: ctx.workspace.id,
      nature,
      description: d.description,
      project_id: d.projectId,
      project_cost_category_id:
        d.kind === "cost" ? d.costCategoryId || null : null,
      account_id: d.accountId || null,
      planned_amount: d.amount,
      actual_amount: d.realizedNow ? d.amount : null,
      competence_month: `${d.date.slice(0, 7)}-01`,
      realized_date: d.realizedNow ? d.date : null,
      due_date: d.realizedNow ? null : d.date,
      status: d.realizedNow ? "realized" : "planned",
      origin: "manual",
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: `project.${d.kind}_added`,
    entity_type: "transaction",
    entity_id: data.id,
    summary: `Lançamento de projeto (${nature}: ${d.amount})`,
  });

  revalidatePath(`/projetos/${d.projectId}`);
  revalidatePath("/projetos");
  return { success: true };
}
