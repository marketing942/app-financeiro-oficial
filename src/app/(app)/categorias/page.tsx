import type { Metadata } from "next";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import { getCategories } from "@/server/categories/queries";
import { resolvePermission } from "@/lib/permissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryDialog } from "./category-dialog";
import { CategoryRow } from "./category-row";

export const metadata: Metadata = { title: "Categorias" };

export default async function CategoriasPage() {
  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const categories = await getCategories(active.id);
  const canEdit = resolvePermission(
    active.role,
    active.permissions,
    "edit_categories"
  );

  const expense = categories.filter((c) => c.kind === "expense");
  const income = categories.filter((c) => c.kind === "income");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Categorias</h1>
        <p className="text-muted-foreground text-sm">
          Organização em até dois níveis: categoria → subcategoria. Arquivar
          nunca apaga lançamentos.
        </p>
      </div>

      <Tabs defaultValue="expense">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="expense">
              Despesas ({expense.filter((c) => !c.archivedAt).length})
            </TabsTrigger>
            <TabsTrigger value="income">
              Receitas ({income.filter((c) => !c.archivedAt).length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="expense" className="flex flex-col gap-3 pt-2">
          {canEdit && (
            <div className="self-end">
              <CategoryDialog kind="expense" />
            </div>
          )}
          {expense.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              canEdit={canEdit}
            />
          ))}
        </TabsContent>

        <TabsContent value="income" className="flex flex-col gap-3 pt-2">
          {canEdit && (
            <div className="self-end">
              <CategoryDialog kind="income" />
            </div>
          )}
          {income.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhuma categoria de receita ainda.{" "}
              {canEdit
                ? "Crie categorias como “Salário”, “Comissões” ou “Rendimentos”."
                : ""}
            </p>
          ) : (
            income.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                canEdit={canEdit}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
