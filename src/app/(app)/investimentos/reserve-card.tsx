"use client";

import { useState, useTransition } from "react";
import { Loader2, PiggyBank } from "lucide-react";
import { toast } from "sonner";

import { updateReserveSettings } from "@/server/investments/actions";
import type { ReserveSummary } from "@/lib/finance/investments";
import { formatBRL } from "@/lib/finance/money";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CategoryOption = { id: string; name: string };

export function ReserveCard({
  summary,
  isOwner,
  expenseCategories,
  essentialIds,
}: {
  summary: ReserveSummary | null;
  isOwner: boolean;
  expenseCategories: CategoryOption[];
  essentialIds: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [months, setMonths] = useState(
    summary?.targetMonths ? String(summary.targetMonths) : "6"
  );
  const [manualTarget, setManualTarget] = useState(
    summary?.manualTarget?.replace(".", ",") ?? ""
  );
  const [selected, setSelected] = useState<string[]>(essentialIds);
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateReserveSettings({
        targetMonths: months ? Number(months) : undefined,
        manualTarget,
        essentialCategoryIds: selected,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Reserva configurada.");
        setEditing(false);
      }
    });
  }

  const percent = summary?.percent ? Number(summary.percent) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PiggyBank className="text-primary size-5" />
          Reserva de emergência
        </CardTitle>
        <CardDescription>
          Meta manual ou calculada: média mensal das despesas essenciais dos
          últimos meses (até 6, incluindo o atual) × meses desejados. Nenhuma
          quantidade é imposta.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Saldo atual</span>
              <span className="font-semibold tabular-nums">
                {formatBRL(summary.currentBalance)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Meta</span>
              <span className="font-semibold tabular-nums">
                {formatBRL(summary.effectiveTarget)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">
                Média essencial/mês
              </span>
              <span className="font-semibold tabular-nums">
                {formatBRL(summary.essentialMonthlyAvg)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground text-xs">Cobertura</span>
              <span className="font-semibold tabular-nums">
                {percent === null ? "—" : `${percent.toFixed(0)}%`}
              </span>
            </div>
          </div>
        )}

        {percent !== null && (
          <div
            role="progressbar"
            aria-valuenow={Math.min(100, Math.round(percent))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Cobertura da reserva de emergência"
            className="bg-muted h-2 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
        )}

        {isOwner &&
          (editing ? (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="reserve-months">Meses desejados</Label>
                  <Input
                    id="reserve-months"
                    type="number"
                    min={1}
                    max={60}
                    value={months}
                    onChange={(event) => setMonths(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="reserve-manual">
                    Meta manual (R$, opcional — substitui o cálculo)
                  </Label>
                  <Input
                    id="reserve-manual"
                    inputMode="decimal"
                    placeholder="Deixe vazio para calcular"
                    value={manualTarget}
                    onChange={(event) => setManualTarget(event.target.value)}
                  />
                </div>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">
                  Categorias essenciais (base do cálculo)
                </legend>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {expenseCategories.map((cat) => (
                    <label
                      key={cat.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selected.includes(cat.id)}
                        onCheckedChange={(checked) =>
                          setSelected((prev) =>
                            checked === true
                              ? [...prev, cat.id]
                              : prev.filter((id) => id !== cat.id)
                          )
                        }
                      />
                      {cat.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={isPending}>
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  Salvar
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setEditing(true)}
            >
              Configurar reserva
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
