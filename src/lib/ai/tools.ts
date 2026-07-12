import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolvePermission,
  type MemberRole,
  type PermissionKey,
  type PermissionOverrides,
} from "@/lib/permissions";
import {
  CHART_KINDS,
  draftTransactionSchema,
  type ChartPayload,
  type NyloStructuredContent,
  type ReportPayload,
} from "@/lib/ai/schemas";
import { getMarketDataProvider } from "@/lib/ai/market";

// Contrato de toda ferramenta (AI_NYLO §3): workspace vem da SESSÃO
// (nunca do modelo), execução com o cliente Supabase do USUÁRIO (RLS
// decide), entrada validada por Zod, máx. 100 linhas, dados sensíveis
// mascarados. O modelo não tem nenhum poder além destas ferramentas.

export type ToolContext = {
  supabase: SupabaseClient;
  workspaceId: string;
  role: MemberRole;
  permissions: PermissionOverrides;
  periodFrom: string; // yyyy-MM-dd
  periodTo: string; // yyyy-MM-dd
};

export type ToolResult = {
  data: unknown;
  summary: string;
  structured?: NyloStructuredContent;
};

type ToolDefinition = {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<any>;
  requires?: PermissionKey;
  execute: (ctx: ToolContext, args: unknown) => Promise<ToolResult>;
};

const periodArgs = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Início do período (yyyy-MM-dd); padrão: período da sessão"),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Fim do período (yyyy-MM-dd); padrão: período da sessão"),
});

function period(ctx: ToolContext, args: { from?: string; to?: string }) {
  return { from: args.from ?? ctx.periodFrom, to: args.to ?? ctx.periodTo };
}

async function rpc(
  ctx: ToolContext,
  fn: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await ctx.supabase.rpc(fn, params);
  if (error) throw new Error(`consulta falhou: ${fn}`);
  return data;
}

function clip<T>(rows: T[] | null | undefined, max = 100): T[] {
  return (rows ?? []).slice(0, max);
}

export const NYLO_TOOLS: ToolDefinition[] = [
  {
    name: "obter_resumo_financeiro",
    description:
      "Resumo do período: totais por natureza (previsto e realizado) e demonstrativo de receitas (bruto, descontos, líquido).",
    schema: periodArgs,
    async execute(ctx, raw) {
      const p = period(ctx, periodArgs.parse(raw));
      const [cashflow, incomes] = await Promise.all([
        rpc(ctx, "monthly_cashflow", {
          p_workspace: ctx.workspaceId,
          p_from: p.from,
          p_to: p.to,
        }),
        rpc(ctx, "income_statement", {
          p_workspace: ctx.workspaceId,
          p_from: p.from,
          p_to: p.to,
        }),
      ]);
      return {
        data: { periodo: p, por_natureza: cashflow, receitas: incomes },
        summary: `Resumo financeiro de ${p.from} a ${p.to}`,
      };
    },
  },
  {
    name: "comparar_previsto_realizado",
    description:
      "Compara valores previstos e realizados por natureza no período.",
    schema: periodArgs,
    async execute(ctx, raw) {
      const p = period(ctx, periodArgs.parse(raw));
      const rows = await rpc(ctx, "monthly_cashflow", {
        p_workspace: ctx.workspaceId,
        p_from: p.from,
        p_to: p.to,
      });
      return {
        data: { periodo: p, comparativo: rows },
        summary: `Previsto × realizado de ${p.from} a ${p.to}`,
      };
    },
  },
  {
    name: "analisar_receitas",
    description:
      "Demonstrativo de receitas do período (bruto, descontos, líquido, previsto × realizado).",
    schema: periodArgs,
    async execute(ctx, raw) {
      const p = period(ctx, periodArgs.parse(raw));
      const statement = await rpc(ctx, "income_statement", {
        p_workspace: ctx.workspaceId,
        p_from: p.from,
        p_to: p.to,
      });
      return {
        data: { periodo: p, demonstrativo: statement },
        summary: `Receitas de ${p.from} a ${p.to}`,
      };
    },
  },
  {
    name: "analisar_despesas",
    description:
      "Gastos de consumo por categoria no período (previsto e realizado).",
    schema: periodArgs,
    async execute(ctx, raw) {
      const p = period(ctx, periodArgs.parse(raw));
      const rows = await rpc(ctx, "category_spend", {
        p_workspace: ctx.workspaceId,
        p_from: p.from,
        p_to: p.to,
      });
      return {
        data: { periodo: p, por_categoria: clip(rows as unknown[]) },
        summary: `Despesas por categoria de ${p.from} a ${p.to}`,
      };
    },
  },
  {
    name: "analisar_financiamentos",
    description:
      "Financiamentos e dívidas: saldos, parcelas, finalidade (só consumo próprio entra nos 20%).",
    schema: z.object({}),
    async execute(ctx) {
      const { data } = await ctx.supabase
        .from("liabilities")
        .select(
          "name, purpose_classification, original_amount, current_balance, paid_amount, installment_amount, installments_remaining, next_due_date, status"
        )
        .eq("workspace_id", ctx.workspaceId)
        .limit(100);
      return {
        data: { dividas: data ?? [] },
        summary: "Financiamentos e dívidas consultados",
      };
    },
  },
  {
    name: "analisar_regra_50_20_30",
    description:
      "Situação da regra 50/20/30 no período. Igualdade exata está DENTRO do limite; só acima de 100% é ultrapassado.",
    schema: periodArgs,
    async execute(ctx, raw) {
      const p = period(ctx, periodArgs.parse(raw));
      const rows = await rpc(ctx, "rule_50_20_30", {
        p_workspace: ctx.workspaceId,
        p_from: p.from,
        p_to: p.to,
      });
      return {
        data: { periodo: p, regra: rows },
        summary: `Regra 50/20/30 de ${p.from} a ${p.to}`,
      };
    },
  },
  {
    name: "consultar_investimentos",
    description:
      "Investimentos por grupo com saldos e metas, incluindo a reserva de emergência.",
    schema: z.object({}),
    async execute(ctx) {
      const [{ data: investments }, reserve] = await Promise.all([
        ctx.supabase
          .from("investments")
          .select(
            "name, investment_group, subgroup, current_balance, target_amount"
          )
          .eq("workspace_id", ctx.workspaceId)
          .is("archived_at", null)
          .limit(100),
        rpc(ctx, "emergency_reserve_summary", {
          p_workspace: ctx.workspaceId,
        }),
      ]);
      return {
        data: { investimentos: investments ?? [], reserva: reserve },
        summary: "Investimentos e reserva consultados",
      };
    },
  },
  {
    name: "consultar_dividas",
    description: "Dívidas em aberto com saldo, progresso e vencimentos.",
    schema: z.object({}),
    async execute(ctx) {
      const { data } = await ctx.supabase
        .from("liabilities")
        .select(
          "name, purpose_classification, original_amount, current_balance, paid_amount, installments_remaining, next_due_date, status"
        )
        .eq("workspace_id", ctx.workspaceId)
        .not("status", "in", "(settled,canceled)")
        .limit(100);
      return {
        data: { dividas: data ?? [] },
        summary: "Dívidas em aberto consultadas",
      };
    },
  },
  {
    name: "consultar_patrimonio",
    description:
      "Patrimônio atual (bruto, passivos, líquido) e evolução por snapshots.",
    schema: z.object({}),
    async execute(ctx) {
      const [current, { data: snapshots }] = await Promise.all([
        rpc(ctx, "net_worth_current", { p_workspace: ctx.workspaceId }),
        ctx.supabase
          .from("net_worth_snapshots")
          .select("snapshot_date, gross_worth, total_liabilities, net_worth")
          .eq("workspace_id", ctx.workspaceId)
          .order("snapshot_date", { ascending: false })
          .limit(12),
      ]);
      return {
        data: { atual: current, evolucao: snapshots ?? [] },
        summary: "Patrimônio consultado",
      };
    },
  },
  {
    name: "consultar_metas",
    description:
      "Progresso de todas as metas: atual, esperado, ritmo, necessidade mensal e status.",
    schema: z.object({}),
    async execute(ctx) {
      const rows = await rpc(ctx, "goal_progress", {
        p_workspace: ctx.workspaceId,
      });
      return {
        data: { metas: clip(rows as unknown[]) },
        summary: "Metas consultadas",
      };
    },
  },
  {
    name: "consultar_projetos",
    description:
      "Projetos e negócios: capital, custos, receitas, resultado, margem e retorno.",
    schema: z.object({}),
    async execute(ctx) {
      const [{ data: projects }, financials] = await Promise.all([
        ctx.supabase
          .from("business_projects")
          .select("id, name, type, status, budget, expected_sale_value")
          .eq("workspace_id", ctx.workspaceId)
          .limit(100),
        rpc(ctx, "project_financials", { p_workspace: ctx.workspaceId }),
      ]);
      return {
        data: { projetos: projects ?? [], indicadores: financials },
        summary: "Projetos consultados",
      };
    },
  },
  {
    name: "listar_vencimentos",
    description: "Próximos vencimentos (contas a pagar) dentro de N dias.",
    schema: z.object({
      dias: z.number().int().min(1).max(365).default(30),
    }),
    async execute(ctx, raw) {
      const args = z
        .object({ dias: z.number().int().min(1).max(365).default(30) })
        .parse(raw);
      const rows = await rpc(ctx, "upcoming_payments", {
        p_workspace: ctx.workspaceId,
        p_days: args.dias,
      });
      return {
        data: { vencimentos: clip(rows as unknown[]) },
        summary: `Vencimentos dos próximos ${args.dias} dias`,
      };
    },
  },
  {
    name: "gerar_dados_de_grafico",
    description:
      "Gera dados estruturados de gráfico a partir das agregações do banco (a UI desenha; você nunca inventa números). Tipos: entradas_saidas_mensal, distribuicao_despesas, rosca_50_20_30, evolucao_patrimonio.",
    schema: z.object({
      tipo: z.enum(CHART_KINDS),
      titulo: z.string().max(80).optional(),
      ...periodArgs.shape,
    }),
    async execute(ctx, raw) {
      const args = z
        .object({
          tipo: z.enum(CHART_KINDS),
          titulo: z.string().max(80).optional(),
          ...periodArgs.shape,
        })
        .parse(raw);
      const p = period(ctx, args);
      const chart = await buildChart(ctx, args.tipo, args.titulo, p);
      return {
        data: chart,
        summary: `Gráfico ${args.tipo} de ${p.from} a ${p.to}`,
        structured: { chart },
      };
    },
  },
  {
    name: "gerar_relatorio",
    description:
      "Relatório tabular do período com as mesmas agregações das telas de relatório.",
    schema: periodArgs,
    requires: "export_reports",
    async execute(ctx, raw) {
      const p = period(ctx, periodArgs.parse(raw));
      const rows = (await rpc(ctx, "category_spend", {
        p_workspace: ctx.workspaceId,
        p_from: p.from,
        p_to: p.to,
      })) as {
        category_name: string;
        planned_total: string;
        actual_total: string;
      }[];
      const report: ReportPayload = {
        title: "Despesas por categoria",
        periodFrom: p.from,
        periodTo: p.to,
        columns: ["Categoria", "Previsto", "Realizado"],
        rows: clip(rows).map((r) => [
          r.category_name,
          String(r.planned_total),
          String(r.actual_total),
        ]),
      };
      return {
        data: report,
        summary: `Relatório de ${p.from} a ${p.to}`,
        structured: { report },
      };
    },
  },
  {
    name: "simular_meta",
    description:
      "Simulação hipotética de meta: quanto por mês para chegar ao alvo. Não grava nada.",
    schema: z.object({
      valor_alvo: z.number().positive(),
      valor_atual: z.number().min(0).default(0),
      meses: z.number().int().min(1).max(600),
    }),
    requires: "use_nylo_advanced",
    async execute(_ctx, raw) {
      const args = z
        .object({
          valor_alvo: z.number().positive(),
          valor_atual: z.number().min(0).default(0),
          meses: z.number().int().min(1).max(600),
        })
        .parse(raw);
      const restante = Math.max(0, args.valor_alvo - args.valor_atual);
      const mensal = (restante / args.meses).toFixed(2);
      return {
        data: {
          valor_restante: restante.toFixed(2),
          necessidade_mensal: mensal,
          meses: args.meses,
          observacao: "Projeção nominal, sem rentabilidade presumida.",
        },
        summary: `Simulação de meta: ${mensal}/mês por ${args.meses} meses`,
      };
    },
  },
  {
    name: "simular_quitacao",
    description:
      "Simula antecipação de uma dívida com valor extra mensal. Não grava nada.",
    schema: z.object({
      nome_da_divida: z.string().min(1).max(100),
      extra_mensal: z.number().min(0).default(0),
    }),
    requires: "use_nylo_advanced",
    async execute(ctx, raw) {
      const args = z
        .object({
          nome_da_divida: z.string().min(1).max(100),
          extra_mensal: z.number().min(0).default(0),
        })
        .parse(raw);
      const { data: matches } = await ctx.supabase
        .from("liabilities")
        .select("id, name")
        .eq("workspace_id", ctx.workspaceId)
        .ilike("name", `%${args.nome_da_divida}%`)
        .limit(5);
      if (!matches?.length) {
        return {
          data: { erro: "nenhuma dívida encontrada com esse nome" },
          summary: "Simulação: dívida não encontrada",
        };
      }
      const sim = await rpc(ctx, "simulate_liability_payoff", {
        p_liability: matches[0].id,
        p_extra_monthly: args.extra_mensal.toFixed(2),
      });
      return {
        data: { divida: matches[0].name, simulacao: sim },
        summary: `Simulação de quitação de "${matches[0].name}"`,
      };
    },
  },
  {
    name: "simular_aporte",
    description:
      "Projeta o saldo de um aporte mensal constante por N meses (nominal, sem rentabilidade presumida). Não grava nada.",
    schema: z.object({
      aporte_mensal: z.number().positive(),
      meses: z.number().int().min(1).max(600),
      saldo_inicial: z.number().min(0).default(0),
    }),
    requires: "use_nylo_advanced",
    async execute(_ctx, raw) {
      const args = z
        .object({
          aporte_mensal: z.number().positive(),
          meses: z.number().int().min(1).max(600),
          saldo_inicial: z.number().min(0).default(0),
        })
        .parse(raw);
      const total = args.saldo_inicial + args.aporte_mensal * args.meses;
      return {
        data: {
          saldo_projetado: total.toFixed(2),
          total_aportado: (args.aporte_mensal * args.meses).toFixed(2),
          observacao:
            "Projeção nominal sem rentabilidade — rendimentos variam e não são garantidos.",
        },
        summary: `Projeção de aporte: ${total.toFixed(2)} em ${args.meses} meses`,
      };
    },
  },
  {
    name: "criar_rascunho_de_lancamento",
    description:
      "Monta um RASCUNHO estruturado de lançamento para o usuário revisar e confirmar manualmente. NUNCA grava nada — sem confirmação humana, nada acontece.",
    schema: draftTransactionSchema,
    async execute(_ctx, raw) {
      const draft = draftTransactionSchema.parse(raw);
      return {
        data: {
          rascunho: draft,
          aviso:
            "Rascunho criado. O usuário precisa revisar e confirmar no formulário para o lançamento existir.",
        },
        summary: `Rascunho: ${draft.description} (${draft.amount})`,
        structured: { draft },
      };
    },
  },
  {
    name: "consultar_cotacoes",
    description:
      "Consulta cotações de mercado via provedor configurado. Sem provedor, informa que não há cotações disponíveis — nunca invente valores.",
    schema: z.object({
      simbolos: z.array(z.string().min(1).max(20)).min(1).max(10),
    }),
    async execute(_ctx, raw) {
      const args = z
        .object({
          simbolos: z.array(z.string().min(1).max(20)).min(1).max(10),
        })
        .parse(raw);
      const provider = getMarketDataProvider();
      const quotes = await provider.getQuotes(args.simbolos);
      return {
        data: quotes,
        summary: quotes.available
          ? `Cotações consultadas (${provider.name})`
          : "Sem provedor de cotações configurado",
        structured: { marketDisclaimer: true },
      };
    },
  },
];

async function buildChart(
  ctx: ToolContext,
  kind: ChartPayload["kind"],
  title: string | undefined,
  p: { from: string; to: string }
): Promise<ChartPayload> {
  if (kind === "distribuicao_despesas") {
    const rows = (await rpc(ctx, "category_spend", {
      p_workspace: ctx.workspaceId,
      p_from: p.from,
      p_to: p.to,
    })) as { category_name: string; actual_total: string }[];
    return {
      kind,
      title: title ?? "Distribuição de despesas",
      points: clip(rows, 12).map((r) => ({
        label: r.category_name,
        values: { realizado: String(r.actual_total) },
      })),
    };
  }
  if (kind === "rosca_50_20_30") {
    const rows = (await rpc(ctx, "rule_50_20_30", {
      p_workspace: ctx.workspaceId,
      p_from: p.from,
      p_to: p.to,
    })) as Record<string, string>[];
    const r = rows[0] ?? {};
    return {
      kind,
      title: title ?? "Regra 50/20/30",
      points: [
        {
          label: "Despesas (50%)",
          values: { valor: String(r.expenses ?? "0") },
        },
        {
          label: "Financiamentos (20%)",
          values: { valor: String(r.financing ?? "0") },
        },
        {
          label: "Investimentos (30%)",
          values: { valor: String(r.investments ?? "0") },
        },
      ],
    };
  }
  if (kind === "evolucao_patrimonio") {
    const { data: snapshots } = await ctx.supabase
      .from("net_worth_snapshots")
      .select("snapshot_date, gross_worth, total_liabilities, net_worth")
      .eq("workspace_id", ctx.workspaceId)
      .order("snapshot_date", { ascending: true })
      .limit(24);
    return {
      kind,
      title: title ?? "Evolução do patrimônio",
      points: (snapshots ?? []).map((s) => ({
        label: String(s.snapshot_date),
        values: {
          bruto: String(s.gross_worth),
          passivos: String(s.total_liabilities),
          liquido: String(s.net_worth),
        },
      })),
    };
  }
  // entradas_saidas_mensal
  const rows = (await rpc(ctx, "monthly_cashflow", {
    p_workspace: ctx.workspaceId,
    p_from: p.from,
    p_to: p.to,
  })) as { nature: string; planned_total: string; actual_total: string }[];
  const inflow = rows
    .filter((r) => ["income", "asset_sale"].includes(r.nature))
    .reduce((acc, r) => acc + Number(r.actual_total), 0);
  const outflow = rows
    .filter((r) =>
      [
        "consumer_expense",
        "consumer_financing",
        "debt_payment",
        "investment_contribution",
      ].includes(r.nature)
    )
    .reduce((acc, r) => acc + Number(r.actual_total), 0);
  return {
    kind,
    title: title ?? "Entradas × saídas",
    points: [
      { label: "Entradas", values: { valor: inflow.toFixed(2) } },
      { label: "Saídas", values: { valor: outflow.toFixed(2) } },
    ],
  };
}

export function findTool(name: string): ToolDefinition | undefined {
  return NYLO_TOOLS.find((t) => t.name === name);
}

export function isToolAllowed(
  tool: ToolDefinition,
  role: MemberRole,
  permissions: PermissionOverrides
): boolean {
  if (!tool.requires) return true;
  return resolvePermission(role, permissions, tool.requires);
}
