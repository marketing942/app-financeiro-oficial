"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { draftTransactionSchema } from "@/lib/ai/schemas";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

type ActionResult = { error: string } | { success: true };

// Confirmação de rascunho da Nylo — endpoint NORMAL de criação, fora do
// loop da IA (AI_NYLO §4). Revalidado no servidor com as permissões do
// usuário; o registro nasce com origin='nylo_draft' e é auditado.
export async function confirmNyloDraft(input: unknown): Promise<ActionResult> {
  const parsed = draftTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Rascunho inválido. Revise os campos." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: GENERIC_ERROR };
  const { active } = await getActiveWorkspace();
  if (!active) return { error: GENERIC_ERROR };

  const d = parsed.data;

  // Naturezas com finalidade obrigatória: rascunho da Nylo assume consumo
  // próprio (o usuário edita no formulário antes de confirmar).
  const needsPurpose = ["consumer_financing", "debt_payment"].includes(
    d.nature
  );

  let categoryId: string | null = null;
  if (d.categoryName) {
    const { data: category } = await supabase
      .from("categories")
      .select("id")
      .eq("workspace_id", active.id)
      .ilike("name", d.categoryName)
      .limit(1)
      .maybeSingle();
    categoryId = category?.id ?? null;
  }

  const { data: created, error } = await supabase
    .from("transactions")
    .insert({
      workspace_id: active.id,
      nature: d.nature,
      description: d.description,
      category_id: categoryId,
      purpose_classification: needsPurpose ? "personal_consumption" : null,
      planned_amount: d.amount,
      actual_amount: d.isPlanned ? null : d.amount,
      competence_month: `${d.date.slice(0, 7)}-01`,
      due_date: d.isPlanned ? d.date : null,
      realized_date: d.isPlanned ? null : d.date,
      status: d.isPlanned ? "planned" : "realized",
      origin: "nylo_draft",
      note: d.note || null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();

  if (error || !created) return { error: GENERIC_ERROR };

  await supabase.from("audit_logs").insert({
    workspace_id: active.id,
    user_id: user.id,
    action: "transaction.created_from_nylo_draft",
    entity_type: "transaction",
    entity_id: created.id,
    summary: `Rascunho da Nylo confirmado: "${d.description}" (${d.amount})`,
  });

  revalidatePath("/despesas");
  revalidatePath("/receitas");
  revalidatePath("/nylo");
  return { success: true };
}

export async function archiveConversation(
  input: unknown
): Promise<ActionResult> {
  const parsed = z
    .object({ conversationId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("ai_conversations")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", parsed.data.conversationId)
    .is("archived_at", null);

  if (error || !count) return { error: GENERIC_ERROR };
  revalidatePath("/nylo");
  return { success: true };
}
