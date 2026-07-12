// Tipos e labels de dívidas — client-safe.

export type LiabilityStatus =
  "active" | "current" | "overdue" | "renegotiated" | "settled" | "canceled";

export const LIABILITY_STATUS_LABELS: Record<LiabilityStatus, string> = {
  active: "Ativa",
  current: "Em dia",
  overdue: "Atrasada",
  renegotiated: "Renegociada",
  settled: "Quitada",
  canceled: "Cancelada",
};

export const LIABILITY_STATUS_VARIANTS: Record<
  LiabilityStatus,
  "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
> = {
  active: "secondary",
  current: "success",
  overdue: "destructive",
  renegotiated: "warning",
  settled: "outline",
  canceled: "outline",
};

export type PurposeClassification =
  "personal_consumption" | "investment" | "commercial_project" | "other";

export const PURPOSE_LABELS: Record<PurposeClassification, string> = {
  personal_consumption: "Consumo próprio",
  investment: "Investimento",
  commercial_project: "Projeto comercial",
  other: "Outra",
};

export type Liability = {
  id: string;
  name: string;
  creditor: string | null;
  purpose: PurposeClassification;
  originalAmount: string;
  currentBalance: string;
  paidAmount: string;
  installmentCount: number | null;
  installmentsRemaining: number | null;
  installmentAmount: string | null;
  nextDueDate: string | null;
  status: LiabilityStatus;
  note: string | null;
};

export type PayoffSimulation = {
  monthsRemaining: number | null;
  projectedFinish: string | null;
  monthlyPayment: string;
  totalToPay: string;
};
