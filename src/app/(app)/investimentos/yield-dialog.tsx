"use client";

import { useState, useTransition } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { recordYield } from "@/server/investments/actions";
import { parseMoneyInput } from "@/lib/finance/money";
import { Button } from "@/components/ui/button";
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

export function YieldDialog({
  investments,
  defaultMonth,
}: {
  investments: Option[];
  defaultMonth: string;
}) {
  const [open, setOpen] = useState(false);
  const [investmentId, setInvestmentId] = useState("");
  const [month, setMonth] = useState(defaultMonth);
  const [kind, setKind] = useState<"gain" | "loss">("gain");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!investmentId) {
      toast.error("Escolha o investimento.");
      return;
    }
    const parsed = parseMoneyInput(amount);
    if (!parsed || parsed === "0.00") {
      toast.error("Informe um valor válido.");
      return;
    }
    const signed = kind === "loss" ? `-${parsed}` : parsed;
    startTransition(async () => {
      const result = await recordYield({
        investmentId,
        month,
        amount: signed,
        note,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Rendimento lançado.");
        setOpen(false);
        setAmount("");
        setNote("");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <TrendingUp />
          Informar rendimento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Informar rendimento do mês</DialogTitle>
          <DialogDescription>
            Lance quanto o investimento rendeu (ou perdeu) no mês. O saldo cresce
            com o rendimento, além dos aportes. Não conta como receita de caixa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label>Investimento</Label>
          <Select value={investmentId} onValueChange={setInvestmentId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Escolher investimento" />
            </SelectTrigger>
            <SelectContent>
              {investments.map((inv) => (
                <SelectItem key={inv.id} value={inv.id}>
                  {inv.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="yield-month">Mês</Label>
            <Input
              id="yield-month"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Tipo</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as "gain" | "loss")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gain">Rendimento (+)</SelectItem>
                <SelectItem value="loss">Prejuízo (−)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="yield-amount">Valor (R$)</Label>
            <Input
              id="yield-amount"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="yield-note">Observação (opcional)</Label>
          <Input
            id="yield-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Lançar rendimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
