import type { Metadata } from "next";
import { PiggyBank } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import {
  getReserveSummary,
  listInvestments,
} from "@/server/investments/queries";
import {
  INVESTMENT_GROUP_LABELS,
  type InvestmentGroup,
} from "@/lib/finance/investments";
import { getAccounts } from "@/server/accounts/queries";
import { getCategories } from "@/server/categories/queries";
import { listTransactionsByMonth } from "@/server/transactions/queries";
import { createClient } from "@/lib/supabase/server";
import { resolvePermission } from "@/lib/permissions";
import { decimalToCents, formatBRL } from "@/lib/finance/money";
import { EXPENSE_STATUS_LABELS, formatDateBR, STATUS_BADGE_VARIANTS } from "@/lib/finance/labels";
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
import { InvestmentDialog } from "./investment-dialog";
import { InvestmentDeleteButton } from "./investment-delete-button";
import { ContributionDialog } from "./contribution-dialog";
import { ReserveCard } from "./reserve-card";

export const metadata: Metadata = { title: "Investimentos" };

const GROUP_ORDER: InvestmentGroup[] = [
  "emergency_opportunity",
  "long_term",
  "real_estate",
  "future_projects",
];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default async function InvestimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(mes ?? "") ? mes! : currentMonth();

  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const supabase = await createClient();
  const [investments, reserve, accounts, categories, contributions, settingsRow] =
    await Promise.all([
      listInvestments(active.id),
      getReserveSummary(active.id),
      getAccounts(active.id),
      getCategories(active.id, "expense"),
      listTransactionsByMonth(active.id, month, ["investment_contribution"]),
      supabase
        .from("workspace_settings")
        .select("essential_category_ids")
        .eq("workspace_id", active.id)
        .maybeSingle(),
    ]);

  const canManage = resolvePermission(
    active.role,
    active.permissions,
    "edit_investments"
  );
  const accountOptions = accounts
    .filter((a) => !a.archivedAt)
    .map((a) => ({ id: a.id, name: a.name }));

  const activeInvestments = investments.filter((i) => !i.archivedAt);
  const totalBalance = activeInvestments.reduce(
    (acc, inv) => acc + decimalToCents(inv.currentBalance),
    0n
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Investimentos
          </h1>
          <p className="text-muted-foreground text-sm">
            Grupo → objetivo → aportes. Total investido:{" "}
            <span className="text-primary font-medium tabular-nums">
              {formatBRL((Number(totalBalance) / 100).toFixed(2))}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeInvestments.length > 0 && (
            <ContributionDialog
              investments={activeInvestments.map((i) => ({
                id: i.id,
                name: i.name,
              }))}
              accounts={accountOptions}
            />
          )}
          {canManage && <InvestmentDialog accounts={accountOptions} />}
        </div>
      </div>

      <ReserveCard
        summary={reserve}
        isOwner={active.role === "owner"}
        expenseCategories={categories
          .filter((c) => !c.archivedAt)
          .map((c) => ({ id: c.id, name: c.name }))}
        essentialIds={
          (settingsRow.data?.essential_category_ids as string[]) ?? []
        }
      />

      {activeInvestments.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <PiggyBank
              className="text-muted-foreground mx-auto size-10"
              aria-hidden="true"
            />
            <CardTitle>Nenhum investimento ainda</CardTitle>
            <CardDescription>
              {canManage
                ? "Crie o primeiro: reserva de emergência, longo prazo, imobiliário ou projetos futuros."
                : "O proprietário ainda não cadastrou investimentos."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        GROUP_ORDER.filter((group) =>
          activeInvestments.some((inv) => inv.group === group)
        ).map((group) => (
          <section key={group} aria-label={INVESTMENT_GROUP_LABELS[group]}>
            <h2 className="mb-2 text-sm font-semibold">
              {INVESTMENT_GROUP_LABELS[group]}
            </h2>
            <div className="flex flex-col gap-2">
              {activeInvestments
                .filter((inv) => inv.group === group)
                .map((inv) => {
                  const target = inv.targetAmount
                    ? decimalToCents(inv.targetAmount)
                    : null;
                  const balance = decimalToCents(inv.currentBalance);
                  const pct =
                    target && target > 0n
                      ? Number((balance * 10000n) / target) / 100
                      : null;
                  return (
                    <Card key={inv.id}>
                      <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="font-medium break-words">
                            {inv.name}
                            {inv.subgroup ? (
                              <span className="text-muted-foreground font-normal">
                                {" "}
                                · {inv.subgroup}
                              </span>
                            ) : null}
                          </span>
                          {pct !== null && (
                            <>
                              <div
                                role="progressbar"
                                aria-valuenow={Math.min(100, Math.round(pct))}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`Progresso da meta de ${inv.name}`}
                                className="bg-muted h-1.5 w-full max-w-64 overflow-hidden rounded-full"
                              >
                                <div
                                  className="bg-primary h-full rounded-full"
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <span className="text-muted-foreground text-xs">
                                {pct.toFixed(0)}% da meta de{" "}
                                {formatBRL(inv.targetAmount)}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 sm:justify-end">
                          <span className="text-sm font-semibold tabular-nums">
                            {formatBRL(inv.currentBalance)}
                          </span>
                          <div className="flex items-center gap-1">
                            <ContributionDialog
                              investmentId={inv.id}
                              investmentName={inv.name}
                              accounts={accountOptions}
                            />
                            {canManage && (
                              <>
                                <InvestmentDialog
                                  investment={inv}
                                  accounts={accountOptions}
                                />
                                <InvestmentDeleteButton
                                  investmentId={inv.id}
                                  investmentName={inv.name}
                                />
                              </>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          </section>
        ))
      )}

      <section aria-label="Aportes do mês" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Aportes do mês</h2>
            <p className="text-muted-foreground text-xs">
              Aportes previstos e realizados. Os recorrentes aparecem todo mês
              para você informar o pagamento, adiar, editar ou excluir.
            </p>
          </div>
          <MonthNav month={month} basePath="/investimentos" />
        </div>

        {contributions.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="text-muted-foreground py-6 text-center text-sm">
              Nenhum aporte neste mês. Use “Lançar aporte” e escolha uma
              repetição para programá-los automaticamente.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {contributions.map((row) => (
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
                      Vence {formatDateBR(row.dueDate)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="flex flex-col items-start tabular-nums sm:items-end">
                      <span className="text-sm font-semibold">
                        {formatBRL(row.actualAmount ?? "0")}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        de {formatBRL(row.plannedAmount ?? "0")} previsto
                      </span>
                    </div>
                    <TransactionActions
                      row={row}
                      kind="investment"
                      accounts={accountOptions}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
