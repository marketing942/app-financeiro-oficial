// Tipos e labels de negócios e projetos — client-safe.

export type ProjectType =
  | "construction_for_sale"
  | "buy_and_renovate"
  | "vehicle_trade"
  | "land"
  | "venture"
  | "commercial"
  | "other";

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  construction_for_sale: "Construção para venda",
  buy_and_renovate: "Compra e reforma",
  vehicle_trade: "Compra e venda de veículos",
  land: "Terreno",
  venture: "Empreendimento",
  commercial: "Projeto comercial",
  other: "Outro",
};

export type ProjectStatus =
  | "planning"
  | "in_progress"
  | "paused"
  | "ready_for_sale"
  | "sold"
  | "completed"
  | "canceled";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planejamento",
  in_progress: "Em andamento",
  paused: "Pausado",
  ready_for_sale: "Pronto para venda",
  sold: "Vendido",
  completed: "Concluído",
  canceled: "Cancelado",
};

export const PROJECT_STATUS_VARIANTS: Record<
  ProjectStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  planning: "outline",
  in_progress: "default",
  paused: "secondary",
  ready_for_sale: "default",
  sold: "default",
  completed: "default",
  canceled: "destructive",
};

export type StageStatus = "pending" | "in_progress" | "done" | "skipped";

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  done: "Concluída",
  skipped: "Pulada",
};

export type ProjectCostKind =
  "direct" | "tax" | "commission" | "fee" | "selling_expense";

export const PROJECT_COST_KIND_LABELS: Record<ProjectCostKind, string> = {
  direct: "Custo direto",
  tax: "Impostos",
  commission: "Comissão",
  fee: "Taxas",
  selling_expense: "Despesas de venda",
};

export type BusinessProject = {
  id: string;
  name: string;
  type: ProjectType;
  description: string | null;
  startDate: string | null;
  expectedEndDate: string | null;
  endDate: string | null;
  budget: string | null;
  initialCapital: string | null;
  expectedSaleValue: string | null;
  status: ProjectStatus;
  note: string | null;
};

export type ProjectFinancials = {
  projectId: string;
  plannedCost: string;
  actualCost: string;
  directCostActual: string;
  deductionCostActual: string;
  capitalInvested: string;
  revenueActual: string;
  grossResult: string;
  netResult: string;
  netMargin: string | null;
  returnOnCapital: string | null;
};

export type ProjectStage = {
  id: string;
  name: string;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  status: StageStatus;
};

export type ProjectCostCategory = {
  id: string;
  name: string;
  kind: ProjectCostKind;
  sortOrder: number;
};

export const TRANSACTION_NATURE_LABELS = {
  project_cost: "Custo",
  project_income: "Receita",
  investment_contribution: "Aporte",
} as const;

export type ProjectTransaction = {
  id: string;
  nature: "project_cost" | "project_income" | "investment_contribution";
  description: string;
  costCategoryId: string | null;
  plannedAmount: string | null;
  actualAmount: string | null;
  competenceMonth: string;
  realizedDate: string | null;
  status: string;
};
