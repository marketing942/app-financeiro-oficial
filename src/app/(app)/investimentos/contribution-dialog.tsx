"use client";

import { useState, useTransition } from "react";
import { HandCoins, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createContribution } from "@/server/investments/actions";
import { parseMoneyInput } from "@/lib/finance/money";
import {
  RECURRENCE_LABELS,
  type RecurrenceOption,
} from "@/lib/finance/labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

export function ContributionDialog({
  investmentId,
  investmentName,
  investments,
  accounts,
}: {
  // Modo por-card: investmentId/investmentName fixos.
  investmentId?: string;
  investmentName?: string;
  // Modo lançador (topo da página): escolhe o investimento na hora.
  investments?: Option[];
  accounts: Option[];
}) {
  const isLauncher = !investmentId;
  const [open, setOpen] = useState(false);
  const [selectedInvestment, setSelectedInvestment] = useState(
    investmentId ?? ""
  );
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [recurrence, setRecurrence] = useState<RecurrenceOption>("none");
  const [installmentCount, setInstallmentCount] = useState("");
  const [realizedNow, setRealizedNow] = useState(true);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const target = investmentId ?? selectedInvestment;
    if (!target) {
      toast.error("Escolha o investimento.");
      return;
    }
    const parsed = parseMoneyInput(amount);
    if (!parsed) {
      toast.error("Informe um valor válido.");
      return;
    }
    if (recurrence === "installment" && !installmentCount) {
      toast.error("Informe o número de parcelas.");
      return;
    }
    startTransition(async () => {
      const result = await createContribution({
        investmentId: target,
        amount: parsed,
        date,
        accountId,
        realizedNow: recurrence === "none" ? realizedNow : false,
        recurrence,
        installmentCount: installmentCount ? Number(installmentCount) : undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          recurrence === "none" ? "Aporte registrado." : "Aporte programado."
        );
        setOpen(false);
        setAmount("");
        setInstallmentCount("");
        setRecurrence("none");
        if (isLauncher) setSelectedInvestment("");
      }
    });
  }

  const title = isLauncher
    ? "Lançar aporte"
    : `Aporte em “${investmentName}”`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isLauncher ? (
          <Button>
            <Plus />
            Lançar aporte
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <HandCoins />
            Aportar
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            O aporte sai da conta de origem e entra no investimento — nunca
            conta como despesa de consumo. Pode ser único, recorrente ou
            parcelado, como uma despesa.
          </DialogDescription>
        </DialogHeader>

        {isLauncher && (
          <div className="flex flex-col gap-2">
            <Label>Investimento</Label>
            <Select
              value={selectedInvestment}
              onValueChange={setSelectedInvestment}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escolher investimento" />
              </SelectTrigger>
              <SelectContent>
                {(investments ?? []).map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    {inv.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ctb-amount">
              {recurrence === "installment" ? "Valor total (R$)" : "Valor (R$)"}
            </Label>
            <Input
              id="ctb-amount"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ctb-date">
              {recurrence === "none" ? "Data" : "Primeiro vencimento"}
            </Label>
            <Input
              id="ctb-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>Repetição</Label>
            <Select
              value={recurrence}
              onValueChange={(v) => setRecurrence(v as RecurrenceOption)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RECURRENCE_LABELS) as RecurrenceOption[]).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {RECURRENCE_LABELS[value]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          {recurrence === "installment" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="ctb-count">Nº de parcelas</Label>
              <Input
                id="ctb-count"
                type="number"
                min={2}
                max={480}
                value={installmentCount}
                onChange={(event) => setInstallmentCount(event.target.value)}
              />
            </div>
          )}
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

        {recurrence === "installment" && (
          <p className="text-muted-foreground text-xs">
            No parcelamento, o valor informado é o TOTAL; as parcelas mensais são
            geradas automaticamente.
          </p>
        )}

        {recurrence === "none" && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={realizedNow}
              onCheckedChange={(checked) => setRealizedNow(checked === true)}
            />
            Já foi transferido (marcar como realizado)
          </label>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Confirmar aporte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
