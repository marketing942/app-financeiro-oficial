// Tipos e labels de metas — client-safe.

export type GoalType =
  | "income"
  | "expense_limit"
  | "contribution"
  | "reserve"
  | "investment"
  | "project"
  | "debt_payoff"
  | "acquisition"
  | "gross_worth"
  | "liability_reduction"
  | "net_worth"
  | "custom";

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  income: "Receita",
  expense_limit: "Limite de despesa",
  contribution: "Aporte",
  reserve: "Reserva",
  investment: "Investimento",
  project: "Projeto",
  debt_payoff: "Quitação de dívida",
  acquisition: "Aquisição",
  gross_worth: "Patrimônio bruto",
  liability_reduction: "Redução de passivos",
  net_worth: "Patrimônio líquido",
  custom: "Personalizada",
};

export type GoalStatus =
  | "not_started"
  | "ahead"
  | "on_track"
  | "attention"
  | "behind"
  | "completed"
  | "expired";

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: "Não iniciada",
  ahead: "Adiantada",
  on_track: "No ritmo",
  attention: "Atenção",
  behind: "Atrasada",
  completed: "Concluída",
  expired: "Vencida",
};

export const GOAL_STATUS_VARIANTS: Record<
  GoalStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  not_started: "outline",
  ahead: "default",
  on_track: "default",
  attention: "secondary",
  behind: "destructive",
  completed: "default",
  expired: "destructive",
};

export type GoalDirection = "maximize" | "minimize";

export type GoalProgress = {
  goalId: string;
  name: string;
  type: GoalType;
  direction: GoalDirection;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  initialValue: string;
  targetValue: string;
  currentValue: string;
  expectedValue: string;
  paceDiff: string;
  monthlyNeedInitial: string;
  monthlyNeedUpdated: string;
  progressPercent: string | null;
  monthsTotal: number;
  monthsElapsed: number;
  monthsRemaining: number;
  startDate: string;
  endDate: string;
  priority: number;
  note: string | null;
  status: GoalStatus;
};

// Horizonte derivado das datas — usado nos filtros de marcos da página
// Planejamento (mensal/anual/5/10/15 anos), sem duplicar metas.
export type GoalHorizon =
  "monthly" | "annual" | "5y" | "10y" | "15y" | "custom";

export const GOAL_HORIZON_LABELS: Record<GoalHorizon, string> = {
  monthly: "Mensal",
  annual: "Anual",
  "5y": "5 anos",
  "10y": "10 anos",
  "15y": "15 anos",
  custom: "Personalizado",
};

export function goalHorizon(monthsTotal: number): GoalHorizon {
  if (monthsTotal <= 1) return "monthly";
  if (monthsTotal === 12) return "annual";
  if (monthsTotal === 60) return "5y";
  if (monthsTotal === 120) return "10y";
  if (monthsTotal === 180) return "15y";
  return "custom";
}
