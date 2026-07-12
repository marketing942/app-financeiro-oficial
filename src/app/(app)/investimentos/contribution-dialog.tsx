"use client";

import { useState, useTransition } from "react";
import { HandCoins, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createContribution } from "@/server/investments/actions";
import { parseMoneyInput } from "@/lib/finance/money";
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
  accounts,
}: {
  investmentId: string;
  investmentName: string;
  accounts: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [realizedNow, setRealizedNow] = useState(true);
  const [monthly, setMonthly] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const parsed = parseMoneyInput(amount);
    if (!parsed) {
      toast.error("Informe um valor válido.");
      return;
    }
    startTransition(async () => {
      const result = await createContribution({
        investmentId,
        amount: parsed,
        date,
        accountId,
        realizedNow: monthly ? false : realizedNow,
        monthly,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          monthly ? "Aporte mensal programado." : "Aporte registrado."
        );
        setOpen(false);
        setAmount("");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <HandCoins />
          Aportar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aporte em “{investmentName}”</DialogTitle>
          <DialogDescription>
            O aporte sai da conta de origem e entra no investimento — nunca
            conta como despesa de consumo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ctb-amount">Valor (R$)</Label>
            <Input
              id="ctb-amount"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ctb-date">Data</Label>
            <Input
              id="ctb-date"
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
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={monthly}
            onCheckedChange={(checked) => setMonthly(checked === true)}
          />
          Repetir mensalmente (programa os próximos 12 meses)
        </label>
        {!monthly && (
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
