import type { Metadata } from "next";
import { HandCoins } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import { listLiabilities } from "@/server/liabilities/queries";
import { getAccounts } from "@/server/accounts/queries";
import { resolvePermission } from "@/lib/permissions";
import { formatBRL } from "@/lib/finance/money";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LiabilityCard } from "@/components/liabilities/liability-card";
import { LiabilityDialog } from "@/components/liabilities/liability-dialog";

export const metadata: Metadata = { title: "Financiamentos" };

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default async function FinanciamentosPage() {
  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const supabase = await createClient();
  const month = currentMonth();
  const [liabilities, accounts, ruleResult] = await Promise.all([
    listLiabilities(active.id, "personal_consumption"),
    getAccounts(active.id),
    supabase.rpc("rule_50_20_30", {
      p_workspace: active.id,
      p_from: `${month}-01`,
      p_to: `${month}-01`,
    }),
  ]);

  const rule = (ruleResult.data as Record<string, unknown>[] | null)?.[0];
  const pctFinancing =
    rule?.pct_financing === null || rule?.pct_financing === undefined
      ? null
      : Number(rule.pct_financing);
  const financingStatus = String(rule?.financing_status ?? "no_base");

  const canManage = resolvePermission(
    active.role,
    active.permissions,
    "edit_liabilities"
  );
  const accountOptions = accounts
    .filter((a) => !a.archivedAt)
    .map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Financiamentos de consumo
          </h1>
          <p className="text-muted-foreground text-sm">
            Somente finalidade “consumo próprio” — é o que entra nos 20% da
            regra 50/20/30. Investimentos e projetos comerciais ficam em
            Dívidas.
          </p>
        </div>
        {canManage && <LiabilityDialog defaultPurpose="personal_consumption" />}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col">
            <span className="text-muted-foreground text-xs">
              Comprometimento no mês (limite: 20% da receita líquida)
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {pctFinancing === null ? "—" : `${pctFinancing.toFixed(2)}%`}
            </span>
          </div>
          <span
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              financingStatus === "above"
                ? "bg-destructive/15 text-destructive"
                : financingStatus === "within"
                  ? "bg-success/15 text-success"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {financingStatus === "above"
              ? "Acima do limite de 20%"
              : financingStatus === "within"
                ? "Dentro do limite (20% exatos ainda é dentro)"
                : "Sem receita realizada no mês"}
          </span>
          {rule && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatBRL(String(rule.financing))} de{" "}
              {formatBRL(String(rule.net_income))} líquidos
            </span>
          )}
        </CardContent>
      </Card>

      {liabilities.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <HandCoins
              className="text-muted-foreground mx-auto size-10"
              aria-hidden="true"
            />
            <CardTitle>Nenhum financiamento de consumo</CardTitle>
            <CardDescription>
              Casa própria, veículo pessoal, móveis, eletrônicos e compras
              parceladas de uso próprio aparecem aqui.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <section
          aria-label="Financiamentos de consumo"
          className="flex flex-col gap-3"
        >
          {liabilities.map((liability) => (
            <LiabilityCard
              key={liability.id}
              liability={liability}
              accounts={accountOptions}
            />
          ))}
        </section>
      )}
    </div>
  );
}
