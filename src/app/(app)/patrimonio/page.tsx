import type { Metadata } from "next";
import { Landmark } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import {
  getNetWorth,
  listAssets,
  listSnapshots,
} from "@/server/assets/queries";
import { listLiabilities } from "@/server/liabilities/queries";
import { getAccounts } from "@/server/accounts/queries";
import { resolvePermission } from "@/lib/permissions";
import { formatBRL } from "@/lib/finance/money";
import { formatDateBR } from "@/lib/finance/labels";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AssetDialog } from "./asset-dialog";
import { AssetCard } from "./asset-card";
import { SnapshotButton } from "./snapshot-button";
import { SnapshotDeleteButton } from "./snapshot-delete-button";

export const metadata: Metadata = { title: "Patrimônio" };

export default async function PatrimonioPage() {
  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const [assets, netWorth, snapshots, liabilities, accounts] =
    await Promise.all([
      listAssets(active.id),
      getNetWorth(active.id),
      listSnapshots(active.id),
      listLiabilities(active.id),
      getAccounts(active.id),
    ]);

  const canManage = resolvePermission(
    active.role,
    active.permissions,
    "edit_assets"
  );
  const accountOptions = accounts
    .filter((a) => !a.archivedAt)
    .map((a) => ({ id: a.id, name: a.name }));
  const liabilityOptions = liabilities
    .filter((l) => !["settled", "canceled"].includes(l.status))
    .map((l) => ({ id: l.id, name: l.name }));

  const activeAssets = assets.filter((a) => a.status === "active");
  const soldAssets = assets.filter((a) => a.status !== "active");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Patrimônio</h1>
          <p className="text-muted-foreground text-sm">
            Bens, avaliações e evolução do patrimônio líquido.
          </p>
        </div>
        {canManage && <AssetDialog liabilities={liabilityOptions} />}
      </div>

      {netWorth && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Patrimônio bruto</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatBRL(netWorth.grossWorth)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              Soma do valor atual dos bens, ponderada pela sua participação.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Dívidas em aberto</CardDescription>
              <CardTitle className="text-destructive text-2xl tabular-nums">
                {formatBRL(netWorth.totalLiabilities)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              Saldo devedor de todas as dívidas e financiamentos ativos.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Patrimônio líquido</CardDescription>
              <CardTitle className="text-primary text-2xl tabular-nums">
                {formatBRL(netWorth.netWorth)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              Bruto − dívidas. Investimentos:{" "}
              {formatBRL(netWorth.investmentsTotal)} · Caixa:{" "}
              {formatBRL(netWorth.cashTotal)}.
            </CardContent>
          </Card>
        </div>
      )}

      {assets.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center py-10 text-center">
            <Landmark
              className="text-muted-foreground mx-auto size-10"
              aria-hidden="true"
            />
            <CardTitle>Nenhum bem cadastrado</CardTitle>
            <CardDescription>
              {canManage
                ? "Cadastre imóveis, veículos, participações e outros bens para acompanhar o patrimônio."
                : "O proprietário ainda não cadastrou bens."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <section aria-label="Bens ativos" className="flex flex-col gap-2">
            {activeAssets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                accounts={accountOptions}
                canManage={canManage}
              />
            ))}
          </section>

          {soldAssets.length > 0 && (
            <section aria-label="Bens vendidos ou baixados">
              <h2 className="mb-2 text-sm font-semibold">
                Vendidos e baixados
              </h2>
              <div className="flex flex-col gap-2 opacity-75">
                {soldAssets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    accounts={accountOptions}
                    canManage={canManage}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section aria-label="Histórico do patrimônio">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Evolução (snapshots)</h2>
          <SnapshotButton />
        </div>
        {snapshots.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum snapshot ainda. Um registro mensal é criado automaticamente;
            você também pode registrar um agora.
          </p>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 pr-4 font-medium">Data</th>
                    <th className="py-2 pr-4 text-right font-medium">Bruto</th>
                    <th className="py-2 pr-4 text-right font-medium">
                      Dívidas
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">
                      Líquido
                    </th>
                    {canManage && <th className="py-2 w-10" aria-label="Ações" />}
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snap) => (
                    <tr
                      key={snap.id}
                      className="border-b tabular-nums last:border-0"
                    >
                      <td className="py-2 pr-4">
                        {formatDateBR(snap.snapshotDate)}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {formatBRL(snap.grossWorth)}
                      </td>
                      <td className="text-destructive py-2 pr-4 text-right">
                        {formatBRL(snap.totalLiabilities)}
                      </td>
                      <td className="text-primary py-2 pr-4 text-right font-medium">
                        {formatBRL(snap.netWorth)}
                      </td>
                      {canManage && (
                        <td className="py-2 text-right">
                          <SnapshotDeleteButton
                            snapshotId={snap.id}
                            label={formatDateBR(snap.snapshotDate)}
                          />
                        </td>
                      )}
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
