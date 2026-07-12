import type { Metadata } from "next";
import { Landmark } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import { listLiabilities } from "@/server/liabilities/queries";
import { getAccounts } from "@/server/accounts/queries";
import { resolvePermission } from "@/lib/permissions";
import { decimalToCents, formatCentsBRL } from "@/lib/finance/money";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LiabilityCard } from "@/components/liabilities/liability-card";
import { LiabilityDialog } from "@/components/liabilities/liability-dialog";

export const metadata: Metadata = { title: "Dívidas" };

export default async function DividasPage() {
  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const [liabilities, accounts] = await Promise.all([
    listLiabilities(active.id),
    getAccounts(active.id),
  ]);

  const canManage = resolvePermission(
    active.role,
    active.permissions,
    "edit_liabilities"
  );
  const accountOptions = accounts
    .filter((a) => !a.archivedAt)
    .map((a) => ({ id: a.id, name: a.name }));

  const open = liabilities.filter(
    (l) => !["settled", "canceled"].includes(l.status)
  );
  const closed = liabilities.filter((l) =>
    ["settled", "canceled"].includes(l.status)
  );

  const totalBalance = open.reduce(
    (acc, l) => acc + decimalToCents(l.currentBalance),
    0n
  );
  const totalPaid = liabilities.reduce(
    (acc, l) => acc + decimalToCents(l.paidAmount),
    0n
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dívidas</h1>
          <p className="text-muted-foreground text-sm">
            Pagar reduz caixa, saldo devedor e passivos — nunca o valor dos
            bens.
          </p>
        </div>
        {canManage && <LiabilityDialog />}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              Saldo devedor total
            </span>
            <span className="text-destructive text-sm font-semibold tabular-nums">
              {formatCentsBRL(totalBalance)}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Total já pago</span>
            <span className="text-primary text-sm font-semibold tabular-nums">
              {formatCentsBRL(totalPaid)}
            </span>
          </CardContent>
        </Card>
      </div>

      {open.length === 0 && closed.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <Landmark
              className="text-muted-foreground mx-auto size-10"
              aria-hidden="true"
            />
            <CardTitle>Nenhuma dívida registrada</CardTitle>
            <CardDescription>
              {canManage
                ? "Registre financiamentos, empréstimos e acordos com finalidade classificada."
                : "O proprietário ainda não registrou dívidas."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <section aria-label="Dívidas ativas" className="flex flex-col gap-3">
            {open.map((liability) => (
              <LiabilityCard
                key={liability.id}
                liability={liability}
                accounts={accountOptions}
              />
            ))}
          </section>
          {closed.length > 0 && (
            <section
              aria-label="Dívidas encerradas"
              className="flex flex-col gap-3"
            >
              <h2 className="text-muted-foreground text-sm font-medium">
                Encerradas
              </h2>
              {closed.map((liability) => (
                <LiabilityCard
                  key={liability.id}
                  liability={liability}
                  accounts={accountOptions}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
