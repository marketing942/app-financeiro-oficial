"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function ReportControls({ de, ate }: { de: string; ate: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(de);
  const [to, setTo] = useState(ate);

  function apply(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    router.push(`/relatorios?de=${nextFrom}&ate=${nextTo}`);
  }

  const year = currentMonth().slice(0, 4);
  const presets = [
    { label: "Este mês", from: currentMonth(), to: currentMonth() },
    { label: "Este ano", from: `${year}-01`, to: `${year}-12` },
    {
      label: "Últimos 12 meses",
      from: (() => {
        const [y, m] = currentMonth().split("-").map(Number);
        const total = y * 12 + (m - 1) - 11;
        return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
      })(),
      to: currentMonth(),
    },
  ];

  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      {presets.map((preset) => (
        <Button
          key={preset.label}
          size="sm"
          variant={
            from === preset.from && to === preset.to ? "default" : "outline"
          }
          onClick={() => apply(preset.from, preset.to)}
        >
          {preset.label}
        </Button>
      ))}
      <div className="flex flex-col gap-1">
        <Label htmlFor="report-from" className="text-xs">
          De
        </Label>
        <Input
          id="report-from"
          type="month"
          className="h-8 w-36"
          value={from}
          onChange={(event) => {
            if (event.target.value) apply(event.target.value, to);
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="report-to" className="text-xs">
          Até
        </Label>
        <Input
          id="report-to"
          type="month"
          className="h-8 w-36"
          value={to}
          onChange={(event) => {
            if (event.target.value) apply(from, event.target.value);
          }}
        />
      </div>
      <Button size="sm" variant="outline" asChild>
        <a href={`/api/relatorios/csv?de=${from}&ate=${to}&tipo=categorias`}>
          <Download />
          CSV categorias
        </a>
      </Button>
      <Button size="sm" variant="outline" asChild>
        <a href={`/api/relatorios/csv?de=${from}&ate=${to}&tipo=mensal`}>
          <Download />
          CSV mensal
        </a>
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.print()}>
        <Printer />
        Imprimir
      </Button>
    </div>
  );
}
