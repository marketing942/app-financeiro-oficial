import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import {
  getCategorySpend,
  getIncomeStatement,
  getMonthlySeries,
} from "@/server/reports/queries";
import { getDashboardSummary, getRule502030 } from "@/server/dashboard/queries";
import { formatBRL } from "@/lib/finance/money";
import { formatMonthBR } from "@/lib/finance/labels";
import type { ChartPayload } from "@/lib/ai/schemas";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PrivacyToggle } from "@/components/privacy-toggle";
import { NyloChart } from "../nylo/nylo-chart";
import { ReportControls } from "./report-controls";
import { CategoryTable } from "./category-table";

export const metadata: Metadata = { title: "Relatórios" };

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const params = await searchParams;
  const de = MONTH_RE.test(params.de ?? "") ? params.de! : currentMonth();
  const ate = MONTH_RE.test(params.ate ?? "") ? params.ate! : currentMonth();
  const from = `${de}-01`;
  const to = `${ate}-01`;

  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const [summary, incomes, categories, series, rule] = await Promise.all([
    getDashboardSummary(active.id, from, to),
    getIncomeStatement(active.id, from, to),
    getCategorySpend(active.id, from, to),
    getMonthlySeries(active.id, from, to),
    getRule502030(active.id, from, to),
  ]);

  const evolutionChart: ChartPayload | null =
    series.length > 1
      ? {
          kind: "evolucao_patrimonio",
          title: "Evolução mensal (realizado)",
          points: series.map((row) => ({
            label: row.month,
            values: {
              receitas: row.netIncomeActual,
              despesas: row.expensesActual,
              "caixa livre": row.freeCash,
            },
          })),
        }
      : null;

  const periodLabel =
    de === ate
      ? formatMonthBR(de)
      : `${formatMonthBR(de)} a ${formatMonthBR(ate)}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="text-muted-foreground text-sm capitalize-first">
            Período: <span className="capitalize">{periodLabel}</span> — mesmos
            números do Dashboard (mesmas agregações do banco).
          </p>
        </div>
        <div className="print:hidden">
          <PrivacyToggle />
        </div>
      </div>

      <ReportControls de={de} ate={ate} />

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Receita líquida realizada</CardDescription>
              <CardTitle className="text-lg tabular-nums">
                {formatBRL(summary.netIncomeActual)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs tabular-nums">
              Previsto: {formatBRL(summary.netIncomePlanned)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Saídas realizadas</CardDescription>
              <CardTitle className="text-lg tabular-nums">
                {formatBRL(summary.outflowsActual)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs tabular-nums">
              Previsto: {formatBRL(summary.outflowsPlanned)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Saldo realizado</CardDescription>
              <CardTitle
                className={`text-lg tabular-nums ${
                  Number(summary.balanceActual) < 0
                    ? "text-destructive"
                    : "text-primary"
                }`}
              >
                {formatBRL(summary.balanceActual)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs tabular-nums">
              Previsto: {formatBRL(summary.balancePlanned)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Regra 50/20/30</CardDescription>
              <CardTitle className="text-lg tabular-nums">
                {rule && rule.pctExpenses !== null
                  ? `${Number(rule.pctExpenses).toLocaleString("pt-BR")} / ${Number(rule.pctFinancing).toLocaleString("pt-BR")} / ${Number(rule.pctInvestments).toLocaleString("pt-BR")}`
                  : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              % da renda em despesas / financiamentos / aportes.
            </CardContent>
          </Card>
        </div>
      )}

      {incomes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Demonstrativo de receitas
            </CardTitle>
            <CardDescription>
              Bruto − descontos = líquido (previsto × realizado).
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-4 font-medium"></th>
                  <th className="py-2 pr-4 text-right font-medium">Bruto</th>
                  <th className="py-2 pr-4 text-right font-medium">
                    Descontos
                  </th>
                  <th className="py-2 text-right font-medium">Líquido</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-b">
                  <td className="py-2 pr-4">Previsto</td>
                  <td className="py-2 pr-4 text-right">
                    {formatBRL(incomes.grossPlanned)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {formatBRL(incomes.deductionsPlanned)}
                  </td>
                  <td className="py-2 text-right">
                    {formatBRL(incomes.netPlanned)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Realizado</td>
                  <td className="py-2 pr-4 text-right">
                    {formatBRL(incomes.grossActual)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {formatBRL(incomes.deductionsActual)}
                  </td>
                  <td className="py-2 text-right">
                    {formatBRL(incomes.netActual)}
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Despesas por categoria</CardTitle>
          <CardDescription>
            Clique nos cabeçalhos para ordenar. Diferença = realizado −
            previsto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhuma despesa categorizada no período.
            </p>
          ) : (
            <CategoryTable rows={categories} />
          )}
        </CardContent>
      </Card>

      {evolutionChart && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolução mensal</CardTitle>
          </CardHeader>
          <CardContent>
            <NyloChart chart={evolutionChart} />
          </CardContent>
        </Card>
      )}

      {series.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resumo mês a mês</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-4 font-medium">Mês</th>
                  <th className="py-2 pr-4 text-right font-medium">
                    Receita líquida
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">Despesas</th>
                  <th className="py-2 pr-4 text-right font-medium">
                    Financiamentos
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">Aportes</th>
                  <th className="py-2 pr-4 text-right font-medium">Dívidas</th>
                  <th className="py-2 text-right font-medium">Caixa livre</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {series.map((row) => (
                  <tr key={row.month} className="border-b last:border-0">
                    <td className="py-2 pr-4 capitalize">
                      {formatMonthBR(row.month)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {formatBRL(row.netIncomeActual)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {formatBRL(row.expensesActual)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {formatBRL(row.financingActual)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {formatBRL(row.contributionsActual)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {formatBRL(row.debtPaymentsActual)}
                    </td>
                    <td
                      className={`py-2 text-right ${
                        Number(row.freeCash) < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {formatBRL(row.freeCash)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" aria-hidden="true" />
            Resumo descritivo com a Nylo
          </CardTitle>
          <CardDescription>
            A Nylo gera um resumo em texto deste período usando as mesmas
            agregações — sem inventar recomendações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" variant="outline">
            <Link href="/nylo">Pedir resumo do período à Nylo</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
