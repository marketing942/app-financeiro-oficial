import { createClient } from "@/lib/supabase/server";
import type { CategoryKind } from "@/lib/validation/finance";

export type Subcategory = {
  id: string;
  categoryId: string;
  name: string;
  sortOrder: number;
  archivedAt: string | null;
};

export type Category = {
  id: string;
  kind: CategoryKind;
  name: string;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  isDefault: boolean;
  archivedAt: string | null;
  subcategories: Subcategory[];
};

export async function getCategories(
  workspaceId: string,
  kind?: CategoryKind
): Promise<Category[]> {
  const supabase = await createClient();

  let query = supabase
    .from("categories")
    .select(
      "id, kind, name, icon, color, sort_order, is_default, archived_at, subcategories(id, category_id, name, sort_order, archived_at)"
    )
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    kind: row.kind as CategoryKind,
    name: row.name,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sort_order,
    isDefault: row.is_default,
    archivedAt: row.archived_at,
    subcategories: (
      (row.subcategories as unknown as Array<{
        id: string;
        category_id: string;
        name: string;
        sort_order: number;
        archived_at: string | null;
      }>) ?? []
    )
      .map((sub) => ({
        id: sub.id,
        categoryId: sub.category_id,
        name: sub.name,
        sortOrder: sub.sort_order,
        archivedAt: sub.archived_at,
      }))
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
      ),
  }));
}
