import { z } from "zod";

// Schemas compartilhados entre as ferramentas da Nylo, o endpoint de
// confirmação e a UI. Rascunho NUNCA é gravado pelo loop da IA — apenas
// devolvido estruturado para revisão e confirmação humana.

export const DRAFT_NATURES = [
  "income",
  "consumer_expense",
  "consumer_financing",
  "investment_contribution",
  "debt_payment",
] as const;

export const draftTransactionSchema = z.object({
  nature: z.enum(DRAFT_NATURES),
  description: z.string().trim().min(1).max(200),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor canônico ex.: 250.00"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryName: z.string().trim().max(60).optional(),
  isPlanned: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
});

export type DraftTransaction = z.infer<typeof draftTransactionSchema>;

export const CHART_KINDS = [
  "entradas_saidas_mensal",
  "distribuicao_despesas",
  "rosca_50_20_30",
  "evolucao_patrimonio",
] as const;

export type ChartKind = (typeof CHART_KINDS)[number];

export type ChartPayload = {
  kind: ChartKind;
  title: string;
  // Pontos com valores em string decimal — a UI converte para número
  // apenas na hora de desenhar (sem cálculo financeiro no cliente).
  points: { label: string; values: Record<string, string> }[];
};

export type ReportPayload = {
  title: string;
  periodFrom: string;
  periodTo: string;
  columns: string[];
  rows: string[][];
};

// Blocos estruturados que uma mensagem da Nylo pode carregar
// (persistidos em ai_messages.content_json e renderizados pela UI).
export type NyloStructuredContent = {
  chart?: ChartPayload;
  report?: ReportPayload;
  draft?: DraftTransaction;
  marketDisclaimer?: boolean;
};
