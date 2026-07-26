import type { Metadata } from "next";
import { TrendingUp } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import {
  getIncomeStatement,
  listTransactionsByMonth,
} from "@/server/transactions/queries";
import { getCategories } from "@/server/categories/queries";
import { getAccounts } from "@/server/accounts/queries";
import { formatBRL } from "@/lib/finance/money";
import {
  formatDateBR,
  INCOME_CLASS_LABELS,
  INCOME_STATUS_LABELS,
  STATUS_BADGE_VARIANTS,
} from "@/lib/finance/labels";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MonthNav } from "@/components/month-nav";
import { TransactionActions } from "@/components/transactions/transaction-actions";
import { IncomeDialog } from "./income-dialog";

export const metadata: Metadata = { title: "Receitas" };

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default async function ReceitasPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(mes ?? "") ? mes! : currentMonth();

  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const [incomes, statement, categories, accounts] = await Promise.all([
    listTransactionsByMonth(active.id, month, ["income"]),
    getIncomeStatement(active.id, month),
    getCategories(active.id, "income"),
    getAccounts(active.id),
  ]);

  // Opções reutilizadas na criação e na edição de receitas.
  const categoryOptions = categories
    .filter((c) => !c.archivedAt)
    .map((c) => ({ id: c.id, name: c.name }));
  const accountOptions = accounts
    .filter((a) => !a.archivedAt)
    .map((a) => ({ id: a.id, name: a.name }));

  const summaryCards = [
    {
      label: "Bruto (previsto × realizado)",
      value: `${formatBRL(statement.grossPlanned)} × ${formatBRL(statement.grossActual)}`,
    },
    {
      label: "Descontos (previsto × realizado)",
      value: `${formatBRL(statement.deductionsPlanned)} × ${formatBRL(statement.deductionsActual)}`,
    },
    {
      label: "Líquido (previsto × realizado)",
      value: `${formatBRL(statement.netPlanned)} × ${formatBRL(statement.netActual)}`,
      highlight: true,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Receitas</h1>
          <p className="text-muted-foreground text-sm">
            Previsto e realizado convivem: registrar o recebido nunca apaga o
            planejado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonthNav month={month} basePath="/receitas" />
          <IncomeDialog
            categories={categoryOptions}
            accounts={accountOptions}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                {card.label}
              </span>
              <span
                className={`text-sm font-semibold tabular-nums ${card.highlight ? "text-primary" : ""}`}
              >
                {card.value}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {incomes.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <TrendingUp
              className="text-muted-foreground mx-auto size-10"
              aria-hidden="true"
            />
            <CardTitle>Nenhuma receita neste mês</CardTitle>
            <CardDescription>
              Registre salários, comissões, aluguéis, dividendos — únicas,
              recorrentes ou parceladas.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <section aria-label="Lista de receitas" className="flex flex-col gap-2">
          {incomes.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex flex-wrap items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">
                      {row.description}
                      {row.installmentNumber
                        ? ` (${row.installmentNumber}/${row.installmentCount})`
                        : ""}
                    </span>
                    <Badge variant={STATUS_BADGE_VARIANTS[row.status]}>
                      {INCOME_STATUS_LABELS[row.status]}
                    </Badge>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {row.incomeClass
                      ? INCOME_CLASS_LABELS[row.incomeClass]
                      : "—"}
                    {row.categoryName ? ` · ${row.categoryName}` : ""}
                    {" · "}Prevista para {formatDateBR(row.dueDate)}
                  </span>
                </div>
                <div className="flex flex-col items-end tabular-nums">
                  <span className="text-sm font-semibold">
                    {formatBRL(row.actualAmount ?? "0")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    de {formatBRL(row.plannedAmount)} previsto
                  </span>
                </div>
                <TransactionActions
                  row={row}
                  kind="income"
                  incomeCategories={categoryOptions}
                  accounts={accountOptions}
                />
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
