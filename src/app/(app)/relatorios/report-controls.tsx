"use client";

import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PeriodFilter } from "@/components/period-filter";

export function ReportControls({ de, ate }: { de: string; ate: string }) {
  return (
    <div className="flex flex-col gap-3 print:hidden">
      <PeriodFilter de={de} ate={ate} basePath="/relatorios" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild>
          <a href={`/api/relatorios/csv?de=${de}&ate=${ate}&tipo=categorias`}>
            <Download />
            CSV categorias
          </a>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href={`/api/relatorios/csv?de=${de}&ate=${ate}&tipo=mensal`}>
            <Download />
            CSV mensal
          </a>
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer />
          Imprimir
        </Button>
      </div>
    </div>
  );
}
