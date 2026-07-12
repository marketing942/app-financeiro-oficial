import type { Metadata } from "next";
import { Wallet } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import { getAccounts } from "@/server/accounts/queries";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AccountDialog } from "./account-dialog";
import { AccountCard } from "./account-card";

export const metadata: Metadata = { title: "Contas" };

export default async function ContasPage() {
  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const accounts = await getAccounts(active.id);
  const canManage = active.role === "owner";
  const activeAccounts = accounts.filter((a) => !a.archivedAt);
  const archivedAccounts = accounts.filter((a) => a.archivedAt);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Contas financeiras
          </h1>
          <p className="text-muted-foreground text-sm">
            Onde o dinheiro está. O saldo calculado passa a aparecer quando os
            lançamentos entrarem (Fase 4).
          </p>
        </div>
        {canManage && <AccountDialog />}
      </div>

      {activeAccounts.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <Wallet
              className="text-muted-foreground mx-auto size-10"
              aria-hidden="true"
            />
            <CardTitle>Nenhuma conta cadastrada</CardTitle>
            <CardDescription>
              {canManage
                ? "Crie sua primeira conta para começar: conta corrente, dinheiro, carteira digital, poupança…"
                : "O proprietário do espaço ainda não cadastrou contas."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <section aria-label="Contas ativas" className="flex flex-col gap-3">
          {activeAccounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              canManage={canManage}
            />
          ))}
        </section>
      )}

      {archivedAccounts.length > 0 && (
        <section aria-label="Contas arquivadas" className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-sm font-medium">
            Arquivadas
          </h2>
          {archivedAccounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              canManage={canManage}
            />
          ))}
        </section>
      )}
    </div>
  );
}
