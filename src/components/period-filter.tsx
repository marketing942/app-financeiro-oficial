"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Mode = "periodo" | "mes" | "ano";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// Deduz o modo a partir dos valores atuais de de/até (URL): meses iguais = mês;
// janeiro→dezembro do mesmo ano = ano; qualquer outra faixa = período.
function inferMode(de: string, ate: string): Mode {
  if (de === ate) return "mes";
  const [dy, dm] = de.split("-");
  const [ay, am] = ate.split("-");
  if (dy === ay && dm === "01" && am === "12") return "ano";
  return "periodo";
}

// Filtro de período unificado (Relatórios e Dashboard). Empurra ?de&ate em
// granularidade mensal (YYYY-MM) para o basePath. A agregação no banco é
// mensal, então o "período que eu quiser" é uma faixa de meses.
export function PeriodFilter({
  de,
  ate,
  basePath,
  extraQuery,
}: {
  de: string;
  ate: string;
  basePath: string;
  // Parâmetros de query preservados ao navegar (ex.: nada por ora).
  extraQuery?: Record<string, string>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(inferMode(de, ate));

  const years = useMemo(() => {
    const thisYear = Number(currentMonth().slice(0, 4));
    return Array.from({ length: 8 }, (_, i) => String(thisYear - i));
  }, []);

  function apply(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams({ de: nextFrom, ate: nextTo });
    for (const [key, value] of Object.entries(extraQuery ?? {})) {
      params.set(key, value);
    }
    router.push(`${basePath}?${params.toString()}`);
  }

  const selectedYear = de.slice(0, 4);

  return (
    <div className="flex flex-col gap-3 print:hidden">
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label="Tipo de filtro de período"
      >
        {(
          [
            ["mes", "Mês"],
            ["ano", "Ano"],
            ["periodo", "Período"],
          ] as [Mode, string][]
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={mode === key ? "default" : "outline"}
            aria-pressed={mode === key}
            onClick={() => {
              setMode(key);
              // Ajusta a faixa ao trocar de modo, mantendo o mês/ano de referência.
              if (key === "mes") {
                const ref = de === ate ? de : currentMonth();
                apply(ref, ref);
              } else if (key === "ano") {
                const year = de.slice(0, 4);
                apply(`${year}-01`, `${year}-12`);
              }
            }}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {mode === "mes" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="period-month" className="text-xs">
              Mês
            </Label>
            <Input
              id="period-month"
              type="month"
              className="h-8 w-40"
              value={de}
              onChange={(event) => {
                if (event.target.value)
                  apply(event.target.value, event.target.value);
              }}
            />
          </div>
        )}

        {mode === "ano" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="period-year" className="text-xs">
              Ano
            </Label>
            <Select
              value={selectedYear}
              onValueChange={(year) => apply(`${year}-01`, `${year}-12`)}
            >
              <SelectTrigger id="period-year" size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode === "periodo" && (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="period-from" className="text-xs">
                De
              </Label>
              <Input
                id="period-from"
                type="month"
                className="h-8 w-40"
                value={de}
                max={ate}
                onChange={(event) => {
                  if (event.target.value) apply(event.target.value, ate);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="period-to" className="text-xs">
                Até
              </Label>
              <Input
                id="period-to"
                type="month"
                className="h-8 w-40"
                value={ate}
                min={de}
                onChange={(event) => {
                  if (event.target.value) apply(de, event.target.value);
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
