"use client";

import { useState, useTransition } from "react";
import { Calculator, HandCoins, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  registerLiabilityPayment,
  simulatePayoff,
} from "@/server/liabilities/actions";
import {
  LIABILITY_STATUS_LABELS,
  LIABILITY_STATUS_VARIANTS,
  PURPOSE_LABELS,
  type Liability,
  type PayoffSimulation,
} from "@/lib/finance/liabilities";
import {
  decimalToCents,
  formatBRL,
  parseMoneyInput,
} from "@/lib/finance/money";
import { formatDateBR } from "@/lib/finance/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

export function LiabilityCard({
  liability,
  accounts,
}: {
  liability: Liability;
  accounts: Option[];
}) {
  const [payOpen, setPayOpen] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [amount, setAmount] = useState(
    liability.installmentAmount?.replace(".", ",") ?? ""
  );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [realizedNow, setRealizedNow] = useState(true);
  const [extra, setExtra] = useState("");
  const [simulation, setSimulation] = useState<PayoffSimulation | null>(null);
  const [isPending, startTransition] = useTransition();

  const original = decimalToCents(liability.originalAmount);
  const paid = decimalToCents(liability.paidAmount);
  const pct = original > 0n ? Number((paid * 10000n) / original) / 100 : null;
  const isOpen = !["settled", "canceled"].includes(liability.status);

  function pay() {
    const parsed = parseMoneyInput(amount);
    if (!parsed) {
      toast.error("Informe um valor válido.");
      return;
    }
    startTransition(async () => {
      const result = await registerLiabilityPayment({
        liabilityId: liability.id,
        amount: parsed,
        date,
        accountId,
        realizedNow,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Pagamento registrado.");
        setPayOpen(false);
      }
    });
  }

  function simulate() {
    const parsed = extra ? parseMoneyInput(extra) : "0";
    if (parsed === null) {
      toast.error("Informe um valor extra válido.");
      return;
    }
    startTransition(async () => {
      const result = await simulatePayoff(liability.id, parsed);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setSimulation(result.data);
      }
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 truncate font-medium">
            {liability.name}
            {liability.creditor ? (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {liability.creditor}
              </span>
            ) : null}
          </span>
          <Badge variant="outline">{PURPOSE_LABELS[liability.purpose]}</Badge>
          <Badge variant={LIABILITY_STATUS_VARIANTS[liability.status]}>
            {LIABILITY_STATUS_LABELS[liability.status]}
          </Badge>
        </div>

        {pct !== null && (
          <>
            <div
              role="progressbar"
              aria-valuenow={Math.min(100, Math.round(pct))}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progresso de quitação de ${liability.name}`}
              className="bg-muted h-2 w-full overflow-hidden rounded-full"
            >
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs tabular-nums">
              <span>
                Pago {formatBRL(liability.paidAmount)} ({pct.toFixed(0)}%)
              </span>
              <span>Resta {formatBRL(liability.currentBalance)}</span>
              {liability.installmentsRemaining !== null && (
                <span>
                  {liability.installmentsRemaining} parcelas restantes
                </span>
              )}
              {liability.nextDueDate && (
                <span>
                  Próximo venc.: {formatDateBR(liability.nextDueDate)}
                </span>
              )}
            </div>
          </>
        )}

        {isOpen && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPayOpen(true)}
            >
              <HandCoins />
              Pagar / amortizar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSimulation(null);
                setSimOpen(true);
              }}
            >
              <Calculator />
              Simular antecipação
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagar “{liability.name}”</DialogTitle>
            <DialogDescription>
              Reduz o caixa e o saldo devedor — o valor dos bens vinculados não
              muda.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`pay-amount-${liability.id}`}>Valor (R$)</Label>
              <Input
                id={`pay-amount-${liability.id}`}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`pay-date-${liability.id}`}>Data</Label>
              <Input
                id={`pay-date-${liability.id}`}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Conta de saída</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Opcional" />
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
              checked={realizedNow}
              onCheckedChange={(checked) => setRealizedNow(checked === true)}
            />
            Já foi pago (marcar como realizado)
          </label>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPayOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={pay} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Confirmar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={simOpen} onOpenChange={setSimOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Simular antecipação</DialogTitle>
            <DialogDescription>
              Quanto a mais por mês acelera a quitação de “{liability.name}”? A
              simulação não grava nada.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor={`sim-extra-${liability.id}`}>
                Extra mensal (R$)
              </Label>
              <Input
                id={`sim-extra-${liability.id}`}
                inputMode="decimal"
                placeholder="0,00"
                value={extra}
                onChange={(event) => setExtra(event.target.value)}
              />
            </div>
            <Button onClick={simulate} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Simular
            </Button>
          </div>
          {simulation && (
            <div className="bg-muted rounded-md p-3 text-sm">
              <p>
                Pagando{" "}
                <strong>{formatBRL(simulation.monthlyPayment)}/mês</strong>,
                você quita em{" "}
                <strong>
                  {simulation.monthsRemaining ?? "—"}{" "}
                  {simulation.monthsRemaining === 1 ? "mês" : "meses"}
                </strong>
                {simulation.projectedFinish
                  ? ` (previsão: ${formatDateBR(simulation.projectedFinish)})`
                  : ""}
                . Saldo a quitar: {formatBRL(simulation.totalToPay)}.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
