import { z } from "zod";

import { moneySchema, nonNegativeMoneySchema } from "@/lib/validation/finance";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.");

const optionalMoney = nonNegativeMoneySchema.optional().or(z.literal(""));

export const RECURRENCE_OPTIONS = [
  "none",
  "installment",
  "weekly",
  "monthly",
  "bimonthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;

const seriesFields = {
  recurrence: z.enum(RECURRENCE_OPTIONS).default("none"),
  installmentCount: z.coerce
    .number()
    .int()
    .min(2, "Mínimo de 2 parcelas.")
    .max(480)
    .optional(),
  recurrenceMonths: z.coerce.number().int().min(2).max(120).optional(),
};

// PAN completo (13–19 dígitos) e CVV nunca são aceitos em campo algum.
const noCardNumber = (value: string | undefined) =>
  !value || !/\d[\s.-]?(\d[\s.-]?){12,18}\d/.test(value);

export const paymentInstructionSchema = z
  .object({
    method: z
      .enum([
        "pix",
        "boleto",
        "bank_transfer",
        "debit",
        "credit",
        "credit_installments",
        "cash",
        "auto_debit",
        "other",
      ])
      .optional(),
    payee: z.string().trim().max(120).optional(),
    pixKeyType: z.enum(["cpf", "cnpj", "email", "phone", "random"]).optional(),
    pixKey: z.string().trim().max(140).optional(),
    bankName: z.string().trim().max(80).optional(),
    bankCode: z.string().trim().max(10).optional(),
    branchNumber: z.string().trim().max(15).optional(),
    accountNumber: z.string().trim().max(30).optional(),
    digitableLine: z.string().trim().max(60).optional(),
    paymentLink: z
      .string()
      .trim()
      .url("Link inválido.")
      .max(500)
      .optional()
      .or(z.literal("")),
    note: z.string().trim().max(300).optional(),
  })
  .refine((data) => noCardNumber(data.note), {
    message: "Não armazene número completo de cartão.",
    path: ["note"],
  })
  .refine((data) => noCardNumber(data.payee), {
    message: "Não armazene número completo de cartão.",
    path: ["payee"],
  });

export const createExpenseSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Informe a descrição.")
      .max(140, "Descrição muito longa."),
    categoryId: z.string().uuid("Escolha a categoria."),
    subcategoryId: z.string().uuid().optional().or(z.literal("")),
    accountId: z.string().uuid().optional().or(z.literal("")),
    plannedAmount: nonNegativeMoneySchema,
    dueDate: dateSchema,
    note: z.string().trim().max(500).optional().or(z.literal("")),
    paymentInstruction: paymentInstructionSchema.optional(),
    ...seriesFields,
  })
  .refine(
    (data) => data.recurrence !== "installment" || !!data.installmentCount,
    { message: "Informe o número de parcelas.", path: ["installmentCount"] }
  );

export const createIncomeSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Informe a descrição.")
      .max(140, "Descrição muito longa."),
    incomeClass: z.enum([
      "active_fixed",
      "active_variable",
      "passive_fixed",
      "passive_variable",
    ]),
    categoryId: z.string().uuid().optional().or(z.literal("")),
    accountId: z.string().uuid().optional().or(z.literal("")),
    // Ou o líquido direto, ou o bruto + descontos (o banco deriva o líquido).
    plannedAmount: optionalMoney,
    grossPlanned: optionalMoney,
    taxPlanned: optionalMoney,
    socialSecurityPlanned: optionalMoney,
    feePlanned: optionalMoney,
    commissionPlanned: optionalMoney,
    otherDeductionsPlanned: optionalMoney,
    dueDate: dateSchema,
    note: z.string().trim().max(500).optional().or(z.literal("")),
    ...seriesFields,
  })
  .refine((data) => data.plannedAmount || data.grossPlanned, {
    message: "Informe o valor líquido ou o bruto previsto.",
    path: ["plannedAmount"],
  })
  .refine(
    (data) => data.recurrence !== "installment" || !!data.installmentCount,
    { message: "Informe o número de parcelas.", path: ["installmentCount"] }
  );

export const markRealizedSchema = z.object({
  transactionId: z.string().uuid(),
  amount: nonNegativeMoneySchema,
  date: dateSchema,
  partial: z.boolean().default(false),
  // Detalhamento opcional do realizado de receitas.
  grossActual: optionalMoney,
  taxActual: optionalMoney,
  socialSecurityActual: optionalMoney,
  feeActual: optionalMoney,
  commissionActual: optionalMoney,
  otherDeductionsActual: optionalMoney,
});

export const transactionIdSchema = z.object({
  transactionId: z.string().uuid(),
});

export const postponeSchema = z.object({
  transactionId: z.string().uuid(),
  dueDate: dateSchema,
});

export type CreateExpenseInput = z.input<typeof createExpenseSchema>;
export type CreateIncomeInput = z.input<typeof createIncomeSchema>;
export type MarkRealizedInput = z.input<typeof markRealizedSchema>;
export { moneySchema };
