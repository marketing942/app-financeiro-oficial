import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Landmark,
  PiggyBank,
  Target,
  TrendingUp,
} from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import {
  getDashboardSummary,
  getExpenseDistributionChart,
  getRule502030,
  getWealthEvolutionChart,
  listAlerts,
  listUpcomingPayments,
} from "@/server/dashboard/queries";
import { getNetWorth } from "@/server/assets/queries";
import { getYieldTotal } from "@/server/investments/queries";
import { listGoalProgress } from "@/server/goals/queries";
import { getProjectFinancials, listProjects } from "@/server/projects/queries";
import { formatBRL } from "@/lib/finance/money";
import { formatDateBR, formatMonthBR } from "@/lib/finance/labels";
import {
  GOAL_STATUS_LABELS,
  GOAL_STATUS_VARIANTS,
  type GoalProgress,
} from "@/lib/finance/goals";
import type { ChartPayload } from "@/lib/ai/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PeriodFilter } from "@/components/period-filter";
import { PrivacyToggle } from "@/components/privacy-toggle";
import { AlertsPanel } from "@/components/alerts-panel";
import { Rule502030 } from "@/components/rule-50-20-30";
import { NyloChart } from "./nylo/nylo-chart";

export const metadata: Metadata = { title: "Dashboard" };

const MONTH_RE = /^\d{4}-\d{2}$/;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// Barra + rótulo de progresso de meta exibidos nos cards de patrimônio e
// investido (reflexo das metas da aba Planejamento).
function GoalReflection({ goal }: { goal: GoalProgress }) {
  const pct = goal.progressPercent ? Number(goal.progressPercent) : null;
  return (
    <div className="mt-1 flex flex-col gap-1">
      {pct !== null && (
        <div
          role="progressbar"
          aria-valuenow={Math.min(100, Math.round(pct))}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progresso da meta ${goal.name}`}
          className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
      <span className="text-muted-foreground text-xs">
        {pct !== null ? `${pct.toLocaleString("pt-BR")}% da ` : "Meta: "}
        meta de {formatBRL(goal.targetValue)}
      </span>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; mes?: string }>;
}) {
  const params = await searchParams;
  // Compatível com o antigo ?mes; senão usa ?de&ate (faixa mensal).
  const fallback = MONTH_RE.test(params.mes ?? "") ? params.mes! : currentMonth();
  const de = MONTH_RE.test(params.de ?? "") ? params.de! : fallback;
  const ate = MONTH_RE.test(params.ate ?? "") ? params.ate! : de;
  const from = `${de}-01`;
  const to = `${ate}-01`;

  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const [
    summary,
    rule,
    alerts,
    upcoming,
    netWorth,
    goals,
    projects,
    projectFin,
    distributionChart,
    wealthChart,
    yieldTotal,
  ] = await Promise.all([
    getDashboardSummary(active.id, from, to),
    getRule502030(active.id, from, to),
    listAlerts(active.id),
    listUpcomingPayments(active.id, 15),
    getNetWorth(active.id),
    listGoalProgress(active.id),
    listProjects(active.id),
    getProjectFinancials(active.id),
    getExpenseDistributionChart(active.id, from, to),
    getWealthEvolutionChart(active.id),
    getYieldTotal(active.id, from, to),
  ]);

  // Metas de estoque que espelham nos cards: patrimônio líquido total e total
  // investido (meta de investimento sem entidade específica = todos).
  const netWorthGoal = goals.find(
    (g) => g.type === "net_worth" && g.status !== "expired"
  );
  const investedGoal = goals.find(
    (g) =>
      g.type === "investment" &&
      !g.relatedEntityId &&
      g.status !== "expired"
  );

  const inOutChart: ChartPayload | null = summary
    ? {
        kind: "entradas_saidas_mensal",
        title: "Previsto × realizado",
        points: [
          {
            label: "Entradas",
            values: {
              previsto: summary.netIncomePlanned,
              realizado: summary.netIncomeActual,
            },
          },
          {
            label: "Saídas",
            values: {
              previsto: summary.outflowsPlanned,
              realizado: summary.outflowsActual,
            },
          },
        ],
      }
    : null;

  const activeGoals = goals
    .filter((g) => !["completed", "expired", "not_started"].includes(g.status))
    .slice(0, 4);
  const activeProjects = projects
    .filter((p) => !["canceled", "completed"].includes(p.status))
    .slice(0, 4);

  const periodLabel =
    de === ate
      ? formatMonthBR(de)
      : `${formatMonthBR(de)} a ${formatMonthBR(ate)}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Período: <span className="capitalize">{periodLabel}</span>
          </p>
        </div>
        <PrivacyToggle />
      </div>

      <PeriodFilter de={de} ate={ate} basePath="/" />

      {/* Cards principais (KPIs) — sempre no topo. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {summary && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Receitas líquidas</CardDescription>
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
                <CardDescription>Despesas</CardDescription>
                <CardTitle className="text-lg tabular-nums">
                  {formatBRL(summary.expensesActual)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs tabular-nums">
                Previsto: {formatBRL(summary.expensesPlanned)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Saldo operacional</CardDescription>
                <CardTitle
                  className={`text-lg tabular-nums ${
                    Number(summary.operatingBalance) < 0
                      ? "text-destructive"
                      : "text-primary"
                  }`}
                >
                  {formatBRL(summary.operatingBalance)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">
                Receitas − despesas do período.
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Caixa livre</CardDescription>
                <CardTitle
                  className={`text-lg tabular-nums ${
                    Number(summary.freeCash) < 0
                      ? "text-destructive"
                      : "text-primary"
                  }`}
                >
                  {formatBRL(summary.freeCash)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-xs">
                Após financiamentos, aportes e dívidas.
              </CardContent>
            </Card>
          </>
        )}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <PiggyBank className="size-3.5" aria-hidden="true" />
              Total investido
            </CardDescription>
            <CardTitle className="text-lg tabular-nums">
              {netWorth ? formatBRL(netWorth.investmentsTotal) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {investedGoal ? (
              <GoalReflection goal={investedGoal} />
            ) : (
              "Soma dos investimentos ativos."
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="size-3.5" aria-hidden="true" />
              Rendimento
            </CardDescription>
            <CardTitle
              className={`text-lg tabular-nums ${
                Number(yieldTotal) < 0 ? "text-destructive" : "text-primary"
              }`}
            >
              {Number(yieldTotal) >= 0 ? "+" : "−"}
              {formatBRL(Math.abs(Number(yieldTotal)).toFixed(2))}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            Quanto seus investimentos renderam no período.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Landmark className="size-3.5" aria-hidden="true" />
              Patrimônio líquido
            </CardDescription>
            <CardTitle className="text-primary text-lg tabular-nums">
              {netWorth ? formatBRL(netWorth.netWorth) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {netWorthGoal ? (
              <GoalReflection goal={netWorthGoal} />
            ) : (
              "Bruto − dívidas."
            )}
          </CardContent>
        </Card>
      </div>

      {/* Gráficos — sempre abaixo dos cards. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {wealthChart && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                Crescimento do patrimônio e investimentos
              </CardTitle>
              <CardDescription>
                Patrimônio líquido e total investido ao longo do tempo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NyloChart chart={wealthChart} />
            </CardContent>
          </Card>
        )}

        {rule && Number(rule.netIncome) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Regra 50/20/30</CardTitle>
              <CardDescription>
                % da renda líquida. No limite = atingido; só acima é
                ultrapassado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Rule502030 rule={rule} />
            </CardContent>
          </Card>
        )}

        {inOutChart && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Entradas × saídas do período
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NyloChart chart={inOutChart} />
            </CardContent>
          </Card>
        )}

        {distributionChart && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Distribuição de despesas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NyloChart chart={distributionChart} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Painéis de apoio. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AlertsPanel alerts={alerts} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Próximos vencimentos</CardTitle>
            <CardDescription>Próximos 15 dias.</CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nada a vencer nos próximos dias.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {upcoming.slice(0, 8).map((payment) => (
                  <li
                    key={payment.transactionId}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {payment.description}
                    </span>
                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatDateBR(payment.dueDate)}
                    </span>
                    <span className="tabular-nums">
                      {formatBRL(payment.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Landmark className="size-4" aria-hidden="true" />
                Patrimônio
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm tabular-nums">
              {netWorth ? (
                <>
                  <p className="flex justify-between">
                    <span>Bruto</span>
                    <span>{formatBRL(netWorth.grossWorth)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span>Dívidas</span>
                    <span className="text-destructive">
                      {formatBRL(netWorth.totalLiabilities)}
                    </span>
                  </p>
                  <p className="flex justify-between font-medium">
                    <span>Líquido</span>
                    <span className="text-primary">
                      {formatBRL(netWorth.netWorth)}
                    </span>
                  </p>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="mt-1 self-start"
                  >
                    <Link href="/patrimonio">
                      Ver patrimônio
                      <ArrowRight />
                    </Link>
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground">Sem dados ainda.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {(activeGoals.length > 0 || activeProjects.length > 0) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {activeGoals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Target className="size-4" aria-hidden="true" />
                  Metas em andamento
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {activeGoals.map((goal) => (
                    <li
                      key={goal.goalId}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {goal.name}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {goal.progressPercent
                          ? `${Number(goal.progressPercent).toLocaleString("pt-BR")}%`
                          : "—"}
                      </span>
                      <Badge variant={GOAL_STATUS_VARIANTS[goal.status]}>
                        {GOAL_STATUS_LABELS[goal.status]}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <Button asChild variant="ghost" size="sm" className="mt-2">
                  <Link href="/planejamento">
                    Ver planejamento
                    <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {activeProjects.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Projetos</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {activeProjects.map((project) => {
                    const fin = projectFin.get(project.id);
                    return (
                      <li
                        key={project.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <Link
                          href={`/projetos/${project.id}`}
                          className="min-w-0 flex-1 truncate hover:underline"
                        >
                          {project.name}
                        </Link>
                        {fin && (
                          <span
                            className={`text-xs tabular-nums ${
                              Number(fin.netResult) < 0
                                ? "text-destructive"
                                : "text-primary"
                            }`}
                          >
                            {formatBRL(fin.netResult)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Button asChild variant="ghost" size="sm" className="mt-2">
                  <Link href="/projetos">
                    Ver projetos
                    <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
