import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import { getProjectFinancials, listProjects } from "@/server/projects/queries";
import { resolvePermission } from "@/lib/permissions";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_VARIANTS,
  PROJECT_TYPE_LABELS,
} from "@/lib/finance/projects";
import { decimalToCents, formatBRL } from "@/lib/finance/money";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProjectDialog } from "./project-dialog";

export const metadata: Metadata = { title: "Negócios e Projetos" };

export default async function ProjetosPage() {
  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const [projects, financials] = await Promise.all([
    listProjects(active.id),
    getProjectFinancials(active.id),
  ]);

  const canManage = resolvePermission(
    active.role,
    active.permissions,
    "edit_projects"
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Negócios e Projetos
          </h1>
          <p className="text-muted-foreground text-sm">
            Custos, aportes e receitas por projeto — fora dos seus gastos
            pessoais.
          </p>
        </div>
        {canManage && <ProjectDialog />}
      </div>

      {projects.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <Briefcase
              className="text-muted-foreground mx-auto size-10"
              aria-hidden="true"
            />
            <CardTitle>Nenhum projeto ainda</CardTitle>
            <CardDescription>
              {canManage
                ? "Crie um projeto de construção, reforma, veículos ou empreendimento para acompanhar custo, margem e retorno."
                : "O proprietário ainda não cadastrou projetos."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {projects.map((project) => {
            const fin = financials.get(project.id);
            const overBudget =
              fin &&
              project.budget &&
              decimalToCents(fin.actualCost) > decimalToCents(project.budget);
            return (
              <Link
                key={project.id}
                href={`/projetos/${project.id}`}
                className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
              >
                <Card className="hover:bg-accent/40 h-full transition-colors">
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 truncate font-medium">
                        {project.name}
                      </span>
                      <Badge variant="outline">
                        {PROJECT_TYPE_LABELS[project.type]}
                      </Badge>
                      <Badge variant={PROJECT_STATUS_VARIANTS[project.status]}>
                        {PROJECT_STATUS_LABELS[project.status]}
                      </Badge>
                    </div>
                    {fin && (
                      <div className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums sm:grid-cols-3">
                        <span>
                          Capital:{" "}
                          <strong className="text-foreground">
                            {formatBRL(fin.capitalInvested)}
                          </strong>
                        </span>
                        <span className={overBudget ? "text-destructive" : ""}>
                          Custo: {formatBRL(fin.actualCost)}
                          {project.budget
                            ? ` / ${formatBRL(project.budget)}`
                            : ""}
                        </span>
                        <span>Receita: {formatBRL(fin.revenueActual)}</span>
                        <span
                          className={
                            Number(fin.netResult) < 0
                              ? "text-destructive"
                              : "text-primary"
                          }
                        >
                          Resultado: {formatBRL(fin.netResult)}
                        </span>
                        <span>
                          Margem:{" "}
                          {fin.netMargin === null
                            ? "—"
                            : `${Number(fin.netMargin).toLocaleString("pt-BR")}%`}
                        </span>
                        <span>
                          Retorno:{" "}
                          {fin.returnOnCapital === null
                            ? "—"
                            : `${Number(fin.returnOnCapital).toLocaleString("pt-BR")}%`}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
