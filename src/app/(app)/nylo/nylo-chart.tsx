"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChartPayload } from "@/lib/ai/schemas";
import { formatBRL } from "@/lib/finance/money";

const COLORS = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
];

// Converte para número SÓ para desenhar — nenhum cálculo financeiro aqui.
function toRows(chart: ChartPayload) {
  return chart.points.map((p) => {
    const row: Record<string, string | number> = { label: p.label };
    for (const [key, value] of Object.entries(p.values)) {
      row[key] = Number(value);
    }
    return row;
  });
}

function tooltipFormatter(value: unknown): string {
  return formatBRL(Number(value).toFixed(2));
}

export function NyloChart({ chart }: { chart: ChartPayload }) {
  const rows = toRows(chart);
  const seriesKeys = Object.keys(chart.points[0]?.values ?? {});

  return (
    <figure className="bg-muted/40 rounded-lg border p-3">
      <figcaption className="mb-2 text-sm font-medium">
        {chart.title}
      </figcaption>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart.kind === "rosca_50_20_30" ? (
            <PieChart>
              <Pie
                data={rows}
                dataKey={seriesKeys[0]}
                nameKey="label"
                innerRadius="55%"
                outerRadius="80%"
              >
                {rows.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={tooltipFormatter} />
              <Legend />
            </PieChart>
          ) : chart.kind === "evolucao_patrimonio" ? (
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} width={80} />
              <Tooltip formatter={tooltipFormatter} />
              <Legend />
              {seriesKeys.map((key, index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[index % COLORS.length]}
                  dot={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} width={80} />
              <Tooltip formatter={tooltipFormatter} />
              {seriesKeys.length > 1 && <Legend />}
              {seriesKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={COLORS[index % COLORS.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        Dados agregados do banco — valores em R$.
      </p>
    </figure>
  );
}
