"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolvePermission } from "@/lib/permissions";
import { nonNegativeMoneySchema } from "@/lib/validation/finance";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

type ActionResult = { error: string } | { success: true };

const assetSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(100),
  type: z.enum([
    "property",
    "land",
    "vehicle",
    "company",
    "equity_stake",
    "financial",
    "equipment",
    "construction",
    "capitalizable_project",
    "other",
  ]),
  purchaseValue: nonNegativeMoneySchema,
  purchaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  ownershipPercent: z.coerce.number().min(0.01).max(100).default(100),
  liabilityId: z.string().uuid().optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

const valuationSchema = z.object({
  assetId: z.string().uuid(),
  eventType: z.enum([
    "appraisal",
    "appreciation",
    "depreciation",
    "improvement",
    "adjustment",
  ]),
  value: nonNegativeMoneySchema,
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  source: z.string().trim().max(120).optional().or(z.literal("")),
});

const sellSchema = z.object({
  assetId: z.string().uuid(),
  saleValue: nonNegativeMoneySchema,
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  accountId: z.string().uuid().optional().or(z.literal("")),
  saleCosts: nonNegativeMoneySchema.optional().or(z.literal("")),
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

export async function createAsset(input: unknown): Promise<ActionResult> {
  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (
    !ctx ||
    !resolvePermission(
      ctx.workspace.role,
      ctx.workspace.permissions,
      "edit_assets"
    )
  ) {
    return { error: "Você não tem permissão para gerenciar o patrimônio." };
  }

  const d = parsed.data;
  const { data, error } = await ctx.supabase
    .from("assets")
    .insert({
      workspace_id: ctx.workspace.id,
      name: d.name,
      type: d.type,
      purchase_value: d.purchaseValue,
      purchase_date: d.purchaseDate || null,
      current_value: d.purchaseValue,
      ownership_percent: d.ownershipPercent,
      liability_id: d.liabilityId || null,
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
    action: "asset.created",
    entity_type: "asset",
    entity_id: data.id,
    summary: `Ativo "${d.name}" cadastrado`,
  });

  revalidatePath("/patrimonio");
  return { success: true };
}

// Nova avaliação: qualquer membro pode atualizar dados patrimoniais
// (atribuição padrão do assistente). O valor de compra nunca muda.
export async function addValuation(input: unknown): Promise<ActionResult> {
  const parsed = valuationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const d = parsed.data;
  const { error } = await ctx.supabase.from("asset_valuations").insert({
    workspace_id: ctx.workspace.id,
    asset_id: d.assetId,
    event_type: d.eventType,
    value: d.value,
    event_date: d.eventDate,
    source: d.source || null,
    created_by: ctx.user.id,
  });

  if (error) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "asset.valuation_added",
    entity_type: "asset",
    entity_id: d.assetId,
    summary: `Avaliação registrada (${d.eventType}: ${d.value})`,
  });

  revalidatePath("/patrimonio");
  return { success: true };
}

export async function sellAssetAction(input: unknown): Promise<ActionResult> {
  const parsed = sellSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const ctx = await requireContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const d = parsed.data;
  const { error } = await ctx.supabase.rpc("sell_asset", {
    p_asset: d.assetId,
    p_sale_value: d.saleValue,
    p_sale_date: d.saleDate,
    p_account: d.accountId || null,
    p_sale_costs: d.saleCosts || "0",
  });

  if (error) {
    if (error.message.includes("not_authorized")) {
      return { error: "Você não tem permissão para vender ativos." };
    }
    if (error.message.includes("asset_already_sold")) {
      return { error: "Este ativo já foi vendido." };
    }
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/patrimonio");
  revalidatePath("/contas");
  return { success: true };
}

export async function takeSnapshot(): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const { error } = await ctx.supabase.rpc("create_net_worth_snapshot", {
    p_workspace: ctx.workspace.id,
    p_date: new Date().toISOString().slice(0, 10),
  });

  if (error) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "net_worth.snapshot_created",
    entity_type: "workspace",
    entity_id: ctx.workspace.id,
    summary: "Snapshot patrimonial criado manualmente",
  });

  revalidatePath("/patrimonio");
  return { success: true };
}
