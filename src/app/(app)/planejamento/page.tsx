import type { Metadata } from "next";
import { Target } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import { listGoalProgress } from "@/server/goals/queries";
import { getCategories } from "@/server/categories/queries";
import { listInvestments } from "@/server/investments/queries";
import { listLiabilities } from "@/server/liabilities/queries";
import { resolvePermission } from "@/lib/permissions";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GoalDialog } from "./goal-dialog";
import { PlanningBoard } from "./planning-board";

export const metadata: Metadata = { title: "Planejamento" };

export default async function PlanejamentoPage() {
  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const [goals, categories, investments, liabilities] = await Promise.all([
    listGoalProgress(active.id),
    getCategories(active.id),
    listInvestments(active.id),
    listLiabilities(active.id),
  ]);

  const canManage = resolvePermission(
    active.role,
    active.permissions,
    "edit_goals"
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Planejamento
          </h1>
          <p className="text-muted-foreground text-sm">
            Todas as metas em um só lugar — ritmo, esperado e necessidade mensal
            calculados do banco.
          </p>
        </div>
        {canManage && (
          <GoalDialog
            categories={categories
              .filter((c) => !c.archivedAt)
              .map((c) => ({ id: c.id, name: c.name }))}
            investments={investments
              .filter((i) => !i.archivedAt)
              .map((i) => ({ id: i.id, name: i.name }))}
            liabilities={liabilities
              .filter((l) => !["settled", "canceled"].includes(l.status))
              .map((l) => ({ id: l.id, name: l.name }))}
          />
        )}
      </div>

      {goals.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <Target
              className="text-muted-foreground mx-auto size-10"
              aria-hidden="true"
            />
            <CardTitle>Nenhuma meta ainda</CardTitle>
            <CardDescription>
              {canManage
                ? "Crie metas de receita, aporte, quitação, patrimônio e mais — o ritmo é acompanhado automaticamente."
                : "O proprietário ainda não criou metas."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <PlanningBoard goals={goals} canManage={canManage} />
      )}
    </div>
  );
}
