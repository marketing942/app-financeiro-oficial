"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { formatMonthBR } from "@/lib/finance/labels";
import { Button } from "@/components/ui/button";

function shiftMonth(monthISO: string, delta: number): string {
  const [year, month] = monthISO.split("-").map(Number);
  const total = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

export function MonthNav({
  month,
  basePath,
}: {
  month: string;
  basePath: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" asChild>
        <Link
          href={`${basePath}?mes=${shiftMonth(month, -1)}`}
          aria-label="Mês anterior"
        >
          <ChevronLeft />
        </Link>
      </Button>
      <span className="min-w-36 text-center text-sm font-medium capitalize">
        {formatMonthBR(month)}
      </span>
      <Button variant="ghost" size="icon" asChild>
        <Link
          href={`${basePath}?mes=${shiftMonth(month, 1)}`}
          aria-label="Próximo mês"
        >
          <ChevronRight />
        </Link>
      </Button>
    </div>
  );
}
