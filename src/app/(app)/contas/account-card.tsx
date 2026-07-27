"use client";

import { createElement, useTransition } from "react";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { deleteAccount, setAccountArchived } from "@/server/accounts/actions";
import type { FinancialAccount } from "@/server/accounts/queries";
import { ACCOUNT_TYPE_LABELS } from "@/lib/validation/finance";
import { formatBRL } from "@/lib/finance/money";
import { getIcon } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { AccountDialog } from "./account-dialog";

const TYPE_ICONS: Record<string, string> = {
  checking: "Landmark",
  cash: "Banknote",
  digital_wallet: "Wallet",
  savings: "PiggyBank",
  investment: "TrendingUp",
  credit_card: "CreditCard",
  project: "Briefcase",
  other: "CircleDollarSign",
};

export function AccountCard({
  account,
  canManage,
}: {
  account: FinancialAccount;
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const archived = !!account.archivedAt;

  function toggleArchive() {
    startTransition(async () => {
      const result = await setAccountArchived(
        { accountId: account.id },
        !archived
      );
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(archived ? "Conta reativada." : "Conta arquivada.");
      }
    });
  }

  return (
    <Card className={archived ? "opacity-70" : undefined}>
      <CardContent className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg"
          style={{
            backgroundColor: (account.color ?? "#64748b") + "22",
            color: account.color ?? "inherit",
          }}
        >
          {createElement(getIcon(TYPE_ICONS[account.type]), {
            className: "size-5",
            "aria-hidden": true,
          })}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{account.name}</span>
            {archived && <Badge variant="secondary">Arquivada</Badge>}
          </div>
          <span className="text-muted-foreground text-xs">
            {ACCOUNT_TYPE_LABELS[account.type]}
            {account.institution ? ` · ${account.institution}` : ""}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-sm font-medium tabular-nums">
            {formatBRL(account.initialBalance)}
          </span>
          <span className="text-muted-foreground text-xs">saldo inicial</span>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center">
            <AccountDialog account={account} />
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleArchive}
              disabled={isPending}
              aria-label={
                archived
                  ? `Reativar conta ${account.name}`
                  : `Arquivar conta ${account.name}`
              }
            >
              {isPending ? (
                <Loader2 className="animate-spin" />
              ) : archived ? (
                <ArchiveRestore />
              ) : (
                <Archive />
              )}
            </Button>
            <ConfirmDeleteButton
              ariaLabel={`Excluir conta ${account.name}`}
              title={`Excluir “${account.name}”?`}
              description="A conta sai das listas e dos cálculos. Os lançamentos vinculados são preservados (exclusão lógica). Se quiser apenas escondê-la temporariamente, use arquivar."
              successMessage="Conta excluída."
              onConfirm={() => deleteAccount({ accountId: account.id })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
