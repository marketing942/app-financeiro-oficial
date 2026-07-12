"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { confirmNyloDraft } from "@/server/nylo/actions";
import { DRAFT_NATURES, type DraftTransaction } from "@/lib/ai/schemas";
import { parseMoneyInput } from "@/lib/finance/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NATURE_LABELS: Record<(typeof DRAFT_NATURES)[number], string> = {
  income: "Receita",
  consumer_expense: "Despesa",
  consumer_financing: "Financiamento (consumo)",
  investment_contribution: "Aporte",
  debt_payment: "Pagamento de dívida",
};

// Rascunho da Nylo: todos os campos editáveis; NADA é criado sem o
// clique explícito em "Confirmar lançamento" (AI_NYLO §4).
export function DraftCard({ draft }: { draft: DraftTransaction }) {
  const [nature, setNature] = useState(draft.nature);
  const [description, setDescription] = useState(draft.description);
  const [amount, setAmount] = useState(draft.amount.replace(".", ","));
  const [date, setDate] = useState(draft.date);
  const [isPlanned, setIsPlanned] = useState(draft.isPlanned);
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    const parsed = parseMoneyInput(amount);
    if (!parsed) {
      toast.error("Informe um valor válido.");
      return;
    }
    startTransition(async () => {
      const result = await confirmNyloDraft({
        nature,
        description,
        amount: parsed,
        date,
        categoryName: draft.categoryName,
        isPlanned,
        note: draft.note,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Lançamento confirmado e criado.");
        setConfirmed(true);
      }
    });
  }

  if (confirmed) {
    return (
      <Card className="border-primary/40">
        <CardContent className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="text-primary size-5" aria-hidden="true" />
          Lançamento “{description}” confirmado e registrado.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Rascunho de lançamento — revise e confirme
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Tipo</Label>
            <Select
              value={nature}
              onValueChange={(v) => setNature(v as typeof nature)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRAFT_NATURES.map((n) => (
                  <SelectItem key={n} value={n}>
                    {NATURE_LABELS[n]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`draft-amount-${draft.description}`}>
              Valor (R$)
            </Label>
            <Input
              id={`draft-amount-${draft.description}`}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`draft-desc-${draft.description}`}>Descrição</Label>
            <Input
              id={`draft-desc-${draft.description}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`draft-date-${draft.description}`}>Data</Label>
            <Input
              id={`draft-date-${draft.description}`}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isPlanned}
            onCheckedChange={(checked) => setIsPlanned(checked === true)}
          />
          Apenas planejado (ainda não realizado)
        </label>
        <Button onClick={confirm} disabled={isPending} className="self-start">
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Confirmar lançamento
        </Button>
      </CardContent>
    </Card>
  );
}
