"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { resolvePermission } from "@/lib/permissions";
import {
  categoryIdSchema,
  categorySchema,
  categoryUpdateSchema,
  reorderCategorySchema,
  subcategoryIdSchema,
  subcategorySchema,
  subcategoryUpdateSchema,
} from "@/lib/validation/finance";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";
const NO_PERMISSION =
  "Você não tem permissão para editar categorias neste espaço.";

type ActionResult = { error: string } | { success: true };

// Editar categorias exige owner ou a permissão granular edit_categories
// (o RLS revalida no banco; aqui produzimos o erro amigável).
async function requireCategoryEditor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { active } = await getActiveWorkspace();
  if (!active) return null;
  if (!resolvePermission(active.role, active.permissions, "edit_categories")) {
    return null;
  }

  return { supabase, user, workspace: active };
}

async function audit(
  ctx: NonNullable<Awaited<ReturnType<typeof requireCategoryEditor>>>,
  action: string,
  entityType: string,
  entityId: string,
  summary: string
) {
  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    summary,
  });
}

export async function createCategory(input: unknown): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const ctx = await requireCategoryEditor();
  if (!ctx) return { error: NO_PERMISSION };

  const { data: last } = await ctx.supabase
    .from("categories")
    .select("sort_order")
    .eq("workspace_id", ctx.workspace.id)
    .eq("kind", parsed.data.kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.supabase
    .from("categories")
    .insert({
      workspace_id: ctx.workspace.id,
      kind: parsed.data.kind,
      name: parsed.data.name,
      icon: parsed.data.icon ?? null,
      color: parsed.data.color ?? null,
      sort_order: (last?.sort_order ?? 0) + 1,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return { error: "Já existe uma categoria ativa com esse nome." };
    }
    return { error: GENERIC_ERROR };
  }

  await audit(
    ctx,
    "category.created",
    "category",
    data.id,
    `Categoria "${parsed.data.name}" criada`
  );
  revalidatePath("/categorias");
  return { success: true };
}

export async function updateCategory(input: unknown): Promise<ActionResult> {
  const parsed = categoryUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const ctx = await requireCategoryEditor();
  if (!ctx) return { error: NO_PERMISSION };

  const { data, error } = await ctx.supabase
    .from("categories")
    .update({
      name: parsed.data.name,
      icon: parsed.data.icon ?? null,
      color: parsed.data.color ?? null,
    })
    .eq("id", parsed.data.categoryId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (error?.code === "23505") {
      return { error: "Já existe uma categoria ativa com esse nome." };
    }
    return { error: GENERIC_ERROR };
  }

  await audit(
    ctx,
    "category.updated",
    "category",
    parsed.data.categoryId,
    `Categoria "${parsed.data.name}" atualizada`
  );
  revalidatePath("/categorias");
  return { success: true };
}

// Arquivar nunca apaga lançamentos: a categoria só sai das listas ativas.
export async function setCategoryArchived(
  input: unknown,
  archived: boolean
): Promise<ActionResult> {
  const parsed = categoryIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireCategoryEditor();
  if (!ctx) return { error: NO_PERMISSION };

  const { data, error } = await ctx.supabase
    .from("categories")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", parsed.data.categoryId)
    .eq("workspace_id", ctx.workspace.id)
    .select("name")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await audit(
    ctx,
    archived ? "category.archived" : "category.unarchived",
    "category",
    parsed.data.categoryId,
    `Categoria "${data.name}" ${archived ? "arquivada" : "reativada"}`
  );
  revalidatePath("/categorias");
  return { success: true };
}

// Exclusão definitiva da categoria (e suas subcategorias). Recusada pelo
// banco se houver lançamentos vinculados — nesse caso, arquive.
export async function deleteCategory(input: unknown): Promise<ActionResult> {
  const parsed = categoryIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireCategoryEditor();
  if (!ctx) return { error: NO_PERMISSION };

  const { data, error } = await ctx.supabase.rpc("delete_category", {
    p_category_id: parsed.data.categoryId,
  });

  if (error) {
    if (error.message.includes("category_in_use")) {
      return {
        error:
          "Não é possível excluir: há lançamentos usando esta categoria ou suas subcategorias. Arquive-a em vez de excluir.",
      };
    }
    if (error.message.includes("not_authorized")) return { error: NO_PERMISSION };
    return { error: GENERIC_ERROR };
  }
  if (!data) return { error: GENERIC_ERROR };

  revalidatePath("/categorias");
  return { success: true };
}

export async function deleteSubcategory(input: unknown): Promise<ActionResult> {
  const parsed = subcategoryIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireCategoryEditor();
  if (!ctx) return { error: NO_PERMISSION };

  const { data, error } = await ctx.supabase.rpc("delete_subcategory", {
    p_subcategory_id: parsed.data.subcategoryId,
  });

  if (error) {
    if (error.message.includes("subcategory_in_use")) {
      return {
        error:
          "Não é possível excluir: há lançamentos usando esta subcategoria. Arquive-a em vez de excluir.",
      };
    }
    if (error.message.includes("not_authorized")) return { error: NO_PERMISSION };
    return { error: GENERIC_ERROR };
  }
  if (!data) return { error: GENERIC_ERROR };

  revalidatePath("/categorias");
  return { success: true };
}

export async function reorderCategory(input: unknown): Promise<ActionResult> {
  const parsed = reorderCategorySchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireCategoryEditor();
  if (!ctx) return { error: NO_PERMISSION };

  const { data: current } = await ctx.supabase
    .from("categories")
    .select("id, kind, sort_order")
    .eq("id", parsed.data.categoryId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();

  if (!current) return { error: GENERIC_ERROR };

  const neighborQuery = ctx.supabase
    .from("categories")
    .select("id, sort_order")
    .eq("workspace_id", ctx.workspace.id)
    .eq("kind", current.kind)
    .is("archived_at", null)
    .limit(1);

  const { data: neighbor } =
    parsed.data.direction === "up"
      ? await neighborQuery
          .lt("sort_order", current.sort_order)
          .order("sort_order", { ascending: false })
          .maybeSingle()
      : await neighborQuery
          .gt("sort_order", current.sort_order)
          .order("sort_order", { ascending: true })
          .maybeSingle();

  if (!neighbor) return { success: true }; // já está na ponta

  // Troca as posições (duas linhas; sem exigir transação).
  await ctx.supabase
    .from("categories")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", current.id);
  await ctx.supabase
    .from("categories")
    .update({ sort_order: current.sort_order })
    .eq("id", neighbor.id);

  revalidatePath("/categorias");
  return { success: true };
}

export async function createSubcategory(input: unknown): Promise<ActionResult> {
  const parsed = subcategorySchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const ctx = await requireCategoryEditor();
  if (!ctx) return { error: NO_PERMISSION };

  const { data, error } = await ctx.supabase
    .from("subcategories")
    .insert({
      workspace_id: ctx.workspace.id,
      category_id: parsed.data.categoryId,
      name: parsed.data.name,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return { error: "Já existe uma subcategoria ativa com esse nome." };
    }
    return { error: GENERIC_ERROR };
  }

  await audit(
    ctx,
    "subcategory.created",
    "subcategory",
    data.id,
    `Subcategoria "${parsed.data.name}" criada`
  );
  revalidatePath("/categorias");
  return { success: true };
}

export async function updateSubcategory(input: unknown): Promise<ActionResult> {
  const parsed = subcategoryUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const ctx = await requireCategoryEditor();
  if (!ctx) return { error: NO_PERMISSION };

  const { data, error } = await ctx.supabase
    .from("subcategories")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.subcategoryId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (error?.code === "23505") {
      return { error: "Já existe uma subcategoria ativa com esse nome." };
    }
    return { error: GENERIC_ERROR };
  }

  await audit(
    ctx,
    "subcategory.updated",
    "subcategory",
    parsed.data.subcategoryId,
    `Subcategoria renomeada para "${parsed.data.name}"`
  );
  revalidatePath("/categorias");
  return { success: true };
}

export async function setSubcategoryArchived(
  input: unknown,
  archived: boolean
): Promise<ActionResult> {
  const parsed = subcategoryIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireCategoryEditor();
  if (!ctx) return { error: NO_PERMISSION };

  const { data, error } = await ctx.supabase
    .from("subcategories")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", parsed.data.subcategoryId)
    .eq("workspace_id", ctx.workspace.id)
    .select("name")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await audit(
    ctx,
    archived ? "subcategory.archived" : "subcategory.unarchived",
    "subcategory",
    parsed.data.subcategoryId,
    `Subcategoria "${data.name}" ${archived ? "arquivada" : "reativada"}`
  );
  revalidatePath("/categorias");
  return { success: true };
}
