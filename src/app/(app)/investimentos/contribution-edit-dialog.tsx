"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateContribution } from "@/server/investments/actions";
import type { TransactionRow } from "@/server/transactions/queries";
import { parseMoneyInput } from "@/lib/finance/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Option = { id: string; name: string };

export function ContributionEditDialog({
  transaction,
  accounts,
  open,
  onOpenChange,
}: {
  transaction: TransactionRow;
  accounts: Option[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amount, setAmount] = useState(
    (transaction.plannedAmount ?? "0").replace(".", ",")
  );
  const [date, setDate] = useState(
    transaction.dueDate ?? new Date().toISOString().slice(0, 10)
  );
  const [accountId, setAccountId] = useState(transaction.accountId ?? "");
  const [isPending, startTransition] = useTransition();

  function submit() {
    const parsed = parseMoneyInput(amount);
    if (!parsed) {
      toast.error("Informe um valor válido.");
      return;
    }
    startTransition(async () => {
      const result = await updateContribution({
        transactionId: transaction.id,
        amount: parsed,
        date,
        accountId,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Aporte atualizado.");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar aporte</DialogTitle>
          <DialogDescription>
            Ajuste o valor previsto, a data ou a conta de origem. O valor já
            aportado, se houver, é preservado.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ctb-edit-amount">Valor previsto (R$)</Label>
            <Input
              id="ctb-edit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ctb-edit-date">Vencimento</Label>
            <Input
              id="ctb-edit-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Conta de origem</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Escolher conta (opcional)" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
