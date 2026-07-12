import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/server/workspaces/queries";
import { getCategorySpend, getMonthlySeries } from "@/server/reports/queries";
import { buildCsv } from "@/lib/reports/csv";

export const runtime = "nodejs";

const paramsSchema = z.object({
  de: z.string().regex(/^\d{4}-\d{2}$/),
  ate: z.string().regex(/^\d{4}-\d{2}$/),
  tipo: z.enum(["categorias", "mensal"]),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = paramsSchema.safeParse({
    de: url.searchParams.get("de"),
    ate: url.searchParams.get("ate"),
    tipo: url.searchParams.get("tipo"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parâmetros inválidos." },
      {
        status: 400,
      }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  const { active } = await getActiveWorkspace();
  if (!active) {
    return NextResponse.json({ error: "Sem espaço ativo." }, { status: 403 });
  }

  const from = `${parsed.data.de}-01`;
  const to = `${parsed.data.ate}-01`;

  let csv: string;
  let filename: string;

  if (parsed.data.tipo === "categorias") {
    const rows = await getCategorySpend(active.id, from, to);
    csv = buildCsv(
      ["Categoria", "Previsto", "Realizado"],
      rows.map((r) => [r.categoryName, r.plannedTotal, r.actualTotal])
    );
    filename = `despesas-por-categoria_${parsed.data.de}_${parsed.data.ate}.csv`;
  } else {
    const rows = await getMonthlySeries(active.id, from, to);
    csv = buildCsv(
      [
        "Mês",
        "Receita líquida",
        "Despesas",
        "Financiamentos",
        "Aportes",
        "Pagamentos de dívidas",
        "Caixa livre",
      ],
      rows.map((r) => [
        r.month,
        r.netIncomeActual,
        r.expensesActual,
        r.financingActual,
        r.contributionsActual,
        r.debtPaymentsActual,
        r.freeCash,
      ])
    );
    filename = `resumo-mensal_${parsed.data.de}_${parsed.data.ate}.csv`;
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
