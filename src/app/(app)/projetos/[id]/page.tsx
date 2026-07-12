import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import {
  getProject,
  getProjectFinancials,
  listCostCategories,
  listProjectTransactions,
  listStages,
} from "@/server/projects/queries";
import { getAccounts } from "@/server/accounts/queries";
import { resolvePermission } from "@/lib/permissions";
import {
  PROJECT_TYPE_LABELS,
  TRANSACTION_NATURE_LABELS,
} from "@/lib/finance/projects";
import { decimalToCents, formatBRL } from "@/lib/finance/money";
import { formatDateBR } from "@/lib/finance/labels";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DeleteProjectButton,
  ProjectStatusSelect,
  ProjectTransactionDialog,
  StageList,
} from "./project-detail-actions";

export const metadata: Metadata = { title: "Projeto" };

export default async function ProjetoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const project = await getProject(active.id, id);
  if (!project) notFound();

  const [financials, stages, costCategories, transactions, accounts] =
    await Promise.all([
      getProjectFinancials(active.id),
      listStages(active.id, id),
      listCostCategories(active.id, id),
      listProjectTransactions(active.id, id),
      getAccounts(active.id),
    ]);

  const fin = financials.get(id);
  const canManage = resolvePermission(
    active.role,
    active.permissions,
    "edit_projects"
  );
  const overBudget =
    fin &&
    project.budget &&
    decimalToCents(fin.actualCost) > decimalToCents(project.budget);
  const categoryName = new Map(costCategories.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/projetos"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Projetos
        </Link>
        <h1 className="w-full text-2xl font-semibold tracking-tight sm:w-auto sm:flex-1">
          {project.name}
        </h1>
        <Badge variant="outline">{PROJECT_TYPE_LABELS[project.type]}</Badge>
        {canManage ? (
          <>
            <ProjectStatusSelect
              projectId={project.id}
              status={project.status}
            />
            <DeleteProjectButton
              projectId={project.id}
              projectName={project.name}
            />
          </>
        ) : null}
      </div>

      {fin && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Capital investido</CardDescription>
              <CardTitle className="text-xl tabular-nums">
                {formatBRL(fin.capitalInvested)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Custo realizado</CardDescription>
              <CardTitle
                className={`text-xl tabular-nums ${overBudget ? "text-destructive" : ""}`}
              >
                {formatBRL(fin.actualCost)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              {project.budget
                ? `Orçamento: ${formatBRL(project.budget)}${overBudget ? " — acima do orçamento" : ""}`
                : "Sem orçamento definido"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Receitas</CardDescription>
              <CardTitle className="text-xl tabular-nums">
                {formatBRL(fin.revenueActual)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              {project.expectedSaleValue
                ? `Venda estimada: ${formatBRL(project.expectedSaleValue)}`
                : "Sem estimativa de venda"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Resultado líquido</CardDescription>
              <CardTitle
                className={`text-xl tabular-nums ${
                  Number(fin.netResult) < 0
                    ? "text-destructive"
                    : "text-primary"
                }`}
              >
                {formatBRL(fin.netResult)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              Bruto: {formatBRL(fin.grossResult)} · Margem:{" "}
              {fin.netMargin === null
                ? "—"
                : `${Number(fin.netMargin).toLocaleString("pt-BR")}%`}{" "}
              · Retorno:{" "}
              {fin.returnOnCapital === null
                ? "—"
                : `${Number(fin.returnOnCapital).toLocaleString("pt-BR")}%`}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Etapas</CardTitle>
          </CardHeader>
          <CardContent>
            <StageList
              projectId={project.id}
              stages={stages}
              canManage={canManage}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Categorias de custo</CardTitle>
            <CardDescription>
              Diretas entram no resultado bruto; impostos, comissões e taxas só
              no líquido.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {costCategories.map((cat) => (
                <li key={cat.id} className="flex items-center gap-2">
                  <span className="flex-1">{cat.name}</span>
                  <Badge
                    variant={cat.kind === "direct" ? "outline" : "secondary"}
                  >
                    {cat.kind === "direct" ? "direto" : "dedução"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <section
        aria-label="Lançamentos do projeto"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Lançamentos</h2>
          {canManage && (
            <ProjectTransactionDialog
              projectId={project.id}
              costCategories={costCategories}
              accounts={accounts
                .filter((a) => !a.archivedAt)
                .map((a) => ({ id: a.id, name: a.name }))}
            />
          )}
        </div>
        {transactions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum lançamento ainda — registre custos, aportes e receitas.
          </p>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 pr-4 font-medium">Data</th>
                    <th className="py-2 pr-4 font-medium">Tipo</th>
                    <th className="py-2 pr-4 font-medium">Descrição</th>
                    <th className="py-2 pr-4 font-medium">Categoria</th>
                    <th className="py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                        {formatDateBR(tx.realizedDate ?? tx.competenceMonth)}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {TRANSACTION_NATURE_LABELS[tx.nature]}
                      </td>
                      <td className="max-w-48 truncate py-2 pr-4">
                        {tx.description}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {tx.costCategoryId
                          ? (categoryName.get(tx.costCategoryId) ?? "—")
                          : "—"}
                      </td>
                      <td
                        className={`py-2 text-right whitespace-nowrap tabular-nums ${
                          tx.nature === "project_income" ? "text-primary" : ""
                        }`}
                      >
                        {formatBRL(tx.actualAmount ?? tx.plannedAmount)}
                        {tx.status !== "realized" &&
                        tx.status !== "partially_realized"
                          ? " (previsto)"
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
