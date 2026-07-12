"use client";

import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpWideNarrow } from "lucide-react";

import type { CategorySpendRow } from "@/server/reports/queries";
import { decimalToCents, formatBRL, formatCentsBRL } from "@/lib/finance/money";
import { Button } from "@/components/ui/button";

type SortKey = "name" | "planned" | "actual" | "diff";

// Ordenação é apresentação, não cálculo: a diferença exibida vem de
// subtração exata em centavos (BigInt) dos valores do banco.
export function CategoryTable({ rows }: { rows: CategorySpendRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("actual");
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let result: number;
      if (sortKey === "name") {
        result = a.categoryName.localeCompare(b.categoryName, "pt-BR");
      } else {
        const value = (row: CategorySpendRow) =>
          sortKey === "planned"
            ? decimalToCents(row.plannedTotal)
            : sortKey === "actual"
              ? decimalToCents(row.actualTotal)
              : decimalToCents(row.actualTotal) -
                decimalToCents(row.plannedTotal);
        const diff = value(a) - value(b);
        result = diff > 0n ? 1 : diff < 0n ? -1 : 0;
      }
      return descending ? -result : result;
    });
    return copy;
  }, [rows, sortKey, descending]);

  function toggle(key: SortKey) {
    if (key === sortKey) setDescending(!descending);
    else {
      setSortKey(key);
      setDescending(key !== "name");
    }
  }

  const SortIcon = descending ? ArrowDownWideNarrow : ArrowUpWideNarrow;

  const header = (key: SortKey, label: string, align = "text-right") => (
    <th className={`py-2 ${align} font-medium`}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-1 text-xs"
        onClick={() => toggle(key)}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        {sortKey === key && <SortIcon className="size-3" />}
      </Button>
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            {header("name", "Categoria", "text-left")}
            {header("planned", "Previsto")}
            {header("actual", "Realizado")}
            {header("diff", "Diferença")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const diff =
              decimalToCents(row.actualTotal) -
              decimalToCents(row.plannedTotal);
            return (
              <tr key={row.categoryId} className="border-b last:border-0">
                <td className="py-2 pr-4">{row.categoryName}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatBRL(row.plannedTotal)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatBRL(row.actualTotal)}
                </td>
                <td
                  className={`py-2 text-right tabular-nums ${
                    diff > 0n ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {diff > 0n ? "+" : ""}
                  {formatCentsBRL(diff)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
