// Labels pt-BR para os enums financeiros. O banco guarda inglês; a UI
// traduz aqui (CLAUDE.md regra 14).

export type TransactionStatus =
  | "planned"
  | "pending"
  | "partially_realized"
  | "realized"
  | "overdue"
  | "no_demand"
  | "canceled";

export const INCOME_STATUS_LABELS: Record<TransactionStatus, string> = {
  planned: "Previsto",
  pending: "A receber",
  partially_realized: "Recebido parcialmente",
  realized: "Recebido",
  overdue: "Vencido",
  no_demand: "Sem demanda",
  canceled: "Cancelado",
};

export const EXPENSE_STATUS_LABELS: Record<TransactionStatus, string> = {
  planned: "Previsto",
  pending: "A pagar",
  partially_realized: "Pago parcialmente",
  realized: "Pago",
  overdue: "Atrasado",
  no_demand: "Sem demanda",
  canceled: "Cancelado",
};

export const STATUS_BADGE_VARIANTS: Record<
  TransactionStatus,
  "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
> = {
  planned: "secondary",
  pending: "secondary",
  partially_realized: "warning",
  realized: "success",
  overdue: "destructive",
  no_demand: "outline",
  canceled: "outline",
};

export type IncomeClass =
  "active_fixed" | "active_variable" | "passive_fixed" | "passive_variable";

export const INCOME_CLASS_LABELS: Record<IncomeClass, string> = {
  active_fixed: "Ativa fixa",
  active_variable: "Ativa variável",
  passive_fixed: "Passiva fixa",
  passive_variable: "Passiva variável",
};

export type RecurrenceOption =
  | "none"
  | "installment"
  | "weekly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "semiannual"
  | "annual";

export const RECURRENCE_LABELS: Record<RecurrenceOption, string> = {
  none: "Única",
  installment: "Parcelada",
  weekly: "Semanal",
  monthly: "Mensal",
  bimonthly: "Bimestral",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

export type PaymentMethodKind =
  | "pix"
  | "boleto"
  | "bank_transfer"
  | "debit"
  | "credit"
  | "credit_installments"
  | "cash"
  | "auto_debit"
  | "other";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodKind, string> = {
  pix: "Pix",
  boleto: "Boleto",
  bank_transfer: "Transferência bancária",
  debit: "Débito",
  credit: "Crédito à vista",
  credit_installments: "Crédito parcelado",
  cash: "Dinheiro",
  auto_debit: "Débito automático",
  other: "Outro",
};

export const PIX_KEY_TYPE_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Chave aleatória",
};

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

// "2026-07" → "julho de 2026"
const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function formatMonthBR(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return `${MONTH_NAMES[(month ?? 1) - 1]} de ${year}`;
}
