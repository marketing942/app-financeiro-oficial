"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  type PieLabelRenderProps,
} from "recharts";

import type { Rule502030 } from "@/server/dashboard/queries";
import { formatBRL } from "@/lib/finance/money";

type Slice = {
  key: string;
  label: string;
  amount: number;
  pct: number | null;
  color: string;
  status: string;
  tone: "ok" | "warn" | "bad";
};

function pctText(pct: string | null): string {
  return pct === null ? "" : `${Number(pct).toLocaleString("pt-BR")}%`;
}

// Rosca com as porcentagens sobre a fatia e legenda com o aviso de cada faixa.
// Regra do 100%: exatamente no limite = atingido; só acima = ultrapassado.
export function Rule502030({ rule }: { rule: Rule502030 }) {
  const slices: Slice[] = [
    {
      key: "expenses",
      label: "Despesas",
      amount: Number(rule.expenses),
      pct: rule.pctExpenses === null ? null : Number(rule.pctExpenses),
      color: "#0ea5e9",
      status:
        rule.expensesStatus === "above"
          ? "ultrapassou 50%"
          : Number(rule.pctExpenses) === 50
            ? "limite de 50% atingido"
            : "dentro do limite de 50%",
      tone: rule.expensesStatus === "above" ? "bad" : "ok",
    },
    {
      key: "financing",
      label: "Financiamentos e dívidas",
      amount: Number(rule.financing),
      pct: rule.pctFinancing === null ? null : Number(rule.pctFinancing),
      color: "#f59e0b",
      status:
        rule.financingStatus === "above"
          ? "ultrapassou 20%"
          : Number(rule.pctFinancing) === 20
            ? "limite de 20% atingido"
            : "dentro do limite de 20%",
      tone: rule.financingStatus === "above" ? "bad" : "ok",
    },
    {
      key: "investments",
      label: "Aportes e investimentos",
      amount: Number(rule.investments),
      pct: rule.pctInvestments === null ? null : Number(rule.pctInvestments),
      color: "#10b981",
      status:
        rule.investmentsStatus === "at_or_above_minimum"
          ? "mínimo de 30% cumprido"
          : "abaixo do mínimo de 30%",
      tone:
        rule.investmentsStatus === "at_or_above_minimum" ? "ok" : "warn",
    },
  ];

  const arc = slices.filter((s) => s.amount > 0);
  const hasArc = arc.length > 0;
  const renderLabel = (props: PieLabelRenderProps) => {
    const i = typeof props.index === "number" ? props.index : -1;
    const s = arc[i];
    return s && s.pct != null ? `${s.pct}%` : "";
  };
  const toneClass: Record<Slice["tone"], string> = {
    ok: "text-muted-foreground",
    warn: "text-amber-600 dark:text-amber-500",
    bad: "text-destructive",
  };

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
      {hasArc && (
        <div className="h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={arc}
                dataKey="amount"
                nameKey="label"
                innerRadius="58%"
                outerRadius="90%"
                startAngle={90}
                endAngle={-270}
                labelLine={false}
                label={renderLabel}
                stroke="none"
              >
                {arc.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <ul className="flex w-full flex-col gap-2 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            <span
              className="mt-1 size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-medium">{s.label}</span>
                <span className="tabular-nums">{pctText(s.pct?.toString() ?? null)}</span>
              </span>
              <span className={`text-xs ${toneClass[s.tone]}`}>
                {s.status} · {formatBRL(s.amount.toFixed(2))}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
