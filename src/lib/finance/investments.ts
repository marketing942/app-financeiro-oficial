// Tipos e labels de investimentos — client-safe (sem imports de servidor).

export type InvestmentGroup =
  "real_estate" | "long_term" | "emergency_opportunity" | "future_projects";

export const INVESTMENT_GROUP_LABELS: Record<InvestmentGroup, string> = {
  real_estate: "Investimentos imobiliários",
  long_term: "Investimentos de longo prazo",
  emergency_opportunity: "Reserva de emergência e oportunidade",
  future_projects: "Projetos futuros",
};

export type Investment = {
  id: string;
  group: InvestmentGroup;
  subgroup: string | null;
  name: string;
  description: string | null;
  initialAmount: string;
  currentBalance: string;
  targetAmount: string | null;
  accountId: string | null;
  archivedAt: string | null;
};

export type ReserveSummary = {
  targetMonths: number | null;
  manualTarget: string | null;
  essentialMonthlyAvg: string;
  computedTarget: string;
  effectiveTarget: string;
  currentBalance: string;
  percent: string | null;
};
