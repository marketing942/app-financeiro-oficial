import type { Metadata } from "next";
import { createElement } from "react";
import { TrendingDown } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import {
  getMonthlyCashflow,
  listTransactionsByMonth,
  type TransactionRow,
} from "@/server/transactions/queries";
import { getCategories } from "@/server/categories/queries";
import { getAccounts } from "@/server/accounts/queries";
import { decimalToCents, formatBRL, formatCentsBRL } from "@/lib/finance/money";
import {
  EXPENSE_STATUS_LABELS,
  formatDateBR,
  STATUS_BADGE_VARIANTS,
} from "@/lib/finance/labels";
import { getIcon } from "@/lib/icons";
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
import { ExpenseDialog } from "./expense-dialog";

export const metadata: Metadata = { title: "Despesas" };

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function sum(rows: TransactionRow[], field: "plannedAmount" | "actualAmount") {
  return rows.reduce((acc, row) => {
    if (row.status === "no_demand" || row.status === "canceled") return acc;
    if (field === "actualAmount" && row.actualAmount === null) return acc;
    return acc + decimalToCents(row[field] ?? "0");
  }, 0n);
}

export default async function DespesasPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(mes ?? "") ? mes! : currentMonth();

  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const [expenses, cashflow, categories, accounts] = await Promise.all([
    listTransactionsByMonth(active.id, month, ["consumer_expense"]),
    getMonthlyCashflow(active.id, month),
    getCategories(active.id, "expense"),
    getAccounts(active.id),
  ]);

  // Opções (categoria → subcategoria e contas) reutilizadas na criação e na
  // edição de despesas.
  const categoryOptions = categories
    .filter((c) => !c.archivedAt)
    .map((c) => ({
      id: c.id,
      name: c.name,
      subcategories: c.subcategories
        .filter((s) => !s.archivedAt)
        .map((s) => ({ id: s.id, name: s.name })),
    }));
  const accountOptions = accounts
    .filter((a) => !a.archivedAt)
    .map((a) => ({ id: a.id, name: a.name }));

  const totals = cashflow["consumer_expense"] ?? { planned: "0", actual: "0" };

  // Categoria → lançamentos (hierarquia visual da especificação).
  const grouped = new Map<string, TransactionRow[]>();
  for (const row of expenses) {
    const key = row.categoryId ?? "none";
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const orderedGroups = [
    ...categories
      .filter((c) => grouped.has(c.id))
      .map((c) => ({ category: c, rows: grouped.get(c.id)! })),
    ...(grouped.has("none")
      ? [{ category: null, rows: grouped.get("none")! }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Despesas</h1>
          <p className="text-muted-foreground text-sm">
            Categoria → subcategoria → lançamento. “Sem demanda” fica visível
            sem entrar nos totais.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonthNav month={month} basePath="/despesas" />
          <ExpenseDialog
            categories={categoryOptions}
            accounts={accountOptions}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              Previsto no mês
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatBRL(totals.planned)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              Realizado no mês
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatBRL(totals.actual)}
            </span>
          </CardContent>
        </Card>
      </div>

      {expenses.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <TrendingDown
              className="text-muted-foreground mx-auto size-10"
              aria-hidden="true"
            />
            <CardTitle>Nenhuma despesa neste mês</CardTitle>
            <CardDescription>
              Registre contas, compras e assinaturas — únicas, recorrentes ou
              parceladas, com dados de pagamento opcionais.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        orderedGroups.map(({ category, rows }) => (
          <section
            key={category?.id ?? "none"}
            aria-label={category?.name ?? "Sem categoria"}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <span
                className="flex size-7 items-center justify-center rounded-md"
                style={{
                  backgroundColor: (category?.color ?? "#64748b") + "22",
                  color: category?.color ?? "inherit",
                }}
              >
                {createElement(getIcon(category?.icon), {
                  className: "size-4",
                  "aria-hidden": true,
                })}
              </span>
              <h2 className="flex-1 text-sm font-semibold">
                {category?.name ?? "Sem categoria"}
              </h2>
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatCentsBRL(sum(rows, "actualAmount"))} de{" "}
                {formatCentsBRL(sum(rows, "plannedAmount"))}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <Card key={row.id}>
                  <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium break-words">
                          {row.description}
                          {row.installmentNumber
                            ? ` (${row.installmentNumber}/${row.installmentCount})`
                            : ""}
                        </span>
                        <Badge variant={STATUS_BADGE_VARIANTS[row.status]}>
                          {EXPENSE_STATUS_LABELS[row.status]}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {row.subcategoryName ? `${row.subcategoryName} · ` : ""}
                        Vence {formatDateBR(row.dueDate)}
                        {row.paymentInstructionId
                          ? " · com dados de pagamento"
                          : ""}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <div className="flex flex-col items-start tabular-nums sm:items-end">
                        <span className="text-sm font-semibold">
                          {formatBRL(row.actualAmount ?? "0")}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          de {formatBRL(row.plannedAmount)} previsto
                        </span>
                      </div>
                      <TransactionActions
                        row={row}
                        kind="expense"
                        expenseCategories={categoryOptions}
                        accounts={accountOptions}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
