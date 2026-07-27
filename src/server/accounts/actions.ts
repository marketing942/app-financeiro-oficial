"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  accountIdSchema,
  accountSchema,
  accountUpdateSchema,
} from "@/lib/validation/finance";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

type ActionResult = { error: string } | { success: true };

async function requireOwnerContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { active } = await getActiveWorkspace();
  if (!active || active.role !== "owner") return null;

  return { supabase, user, workspace: active };
}

export async function createAccount(input: unknown): Promise<ActionResult> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Dados inválidos. Revise os campos e tente novamente." };
  }

  const ctx = await requireOwnerContext();
  if (!ctx) return { error: "Apenas o proprietário gerencia contas." };

  const { data, error } = await ctx.supabase
    .from("financial_accounts")
    .insert({
      workspace_id: ctx.workspace.id,
      name: parsed.data.name,
      type: parsed.data.type,
      institution: parsed.data.institution || null,
      initial_balance: parsed.data.initialBalance,
      credit_limit: parsed.data.creditLimit || null,
      color: parsed.data.color ?? null,
      note: parsed.data.note || null,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return { error: "Já existe uma conta ativa com esse nome." };
    }
    return { error: GENERIC_ERROR };
  }

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "account.created",
    entity_type: "financial_account",
    entity_id: data.id,
    summary: `Conta "${parsed.data.name}" criada`,
  });

  revalidatePath("/contas");
  return { success: true };
}

export async function updateAccount(input: unknown): Promise<ActionResult> {
  const parsed = accountUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Dados inválidos. Revise os campos e tente novamente." };
  }

  const ctx = await requireOwnerContext();
  if (!ctx) return { error: "Apenas o proprietário gerencia contas." };

  const { data, error } = await ctx.supabase
    .from("financial_accounts")
    .update({
      name: parsed.data.name,
      type: parsed.data.type,
      institution: parsed.data.institution || null,
      initial_balance: parsed.data.initialBalance,
      credit_limit: parsed.data.creditLimit || null,
      color: parsed.data.color ?? null,
      note: parsed.data.note || null,
      updated_by: ctx.user.id,
    })
    .eq("id", parsed.data.accountId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (error?.code === "23505") {
      return { error: "Já existe uma conta ativa com esse nome." };
    }
    return { error: GENERIC_ERROR };
  }

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "account.updated",
    entity_type: "financial_account",
    entity_id: parsed.data.accountId,
    summary: `Conta "${parsed.data.name}" atualizada`,
  });

  revalidatePath("/contas");
  return { success: true };
}

// Exclusão lógica da conta: some das listas e dos cálculos (RLS filtra
// deleted_at), mas o histórico dos lançamentos é preservado (regra 9).
export async function deleteAccount(input: unknown): Promise<ActionResult> {
  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireOwnerContext();
  if (!ctx) return { error: "Apenas o proprietário gerencia contas." };

  const { data, error } = await ctx.supabase.rpc("soft_delete_account", {
    p_id: parsed.data.accountId,
  });

  if (error) {
    if (error.message.includes("not_authorized")) {
      return { error: "Apenas o proprietário gerencia contas." };
    }
    return { error: GENERIC_ERROR };
  }
  if (!data) return { error: GENERIC_ERROR };

  revalidatePath("/contas");
  return { success: true };
}

export async function setAccountArchived(
  input: unknown,
  archived: boolean
): Promise<ActionResult> {
  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireOwnerContext();
  if (!ctx) return { error: "Apenas o proprietário gerencia contas." };

  const { data, error } = await ctx.supabase
    .from("financial_accounts")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      updated_by: ctx.user.id,
    })
    .eq("id", parsed.data.accountId)
    .eq("workspace_id", ctx.workspace.id)
    .select("name")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: archived ? "account.archived" : "account.unarchived",
    entity_type: "financial_account",
    entity_id: parsed.data.accountId,
    summary: `Conta "${data.name}" ${archived ? "arquivada" : "reativada"}`,
  });

  revalidatePath("/contas");
  return { success: true };
}
