import { z } from "zod";

import { parseMoneyInput } from "@/lib/finance/money";

// String monetária em formato pt-BR ou canônico → canônico "1234.56".
export const moneySchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = parseMoneyInput(value);
    if (parsed === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe um valor válido (ex.: 1.234,56).",
      });
      return z.NEVER;
    }
    return parsed;
  });

export const nonNegativeMoneySchema = moneySchema.refine(
  (value) => !value.startsWith("-"),
  { message: "O valor não pode ser negativo." }
);

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida.");

export const ACCOUNT_TYPES = [
  "checking",
  "cash",
  "digital_wallet",
  "savings",
  "investment",
  "credit_card",
  "project",
  "other",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Conta corrente",
  cash: "Dinheiro",
  digital_wallet: "Carteira digital",
  savings: "Poupança",
  investment: "Conta de investimento",
  credit_card: "Cartão de crédito",
  project: "Conta de projeto",
  other: "Outros",
};

export const accountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da conta.")
    .max(60, "Nome muito longo."),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().trim().max(80).optional().or(z.literal("")),
  initialBalance: moneySchema,
  creditLimit: nonNegativeMoneySchema.optional().or(z.literal("")),
  color: hexColorSchema.optional(),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export const accountUpdateSchema = accountSchema.extend({
  accountId: z.string().uuid(),
});

export const accountIdSchema = z.object({ accountId: z.string().uuid() });

export const CATEGORY_KINDS = ["expense", "income"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const categorySchema = z.object({
  kind: z.enum(CATEGORY_KINDS),
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(60, "Nome muito longo."),
  icon: z.string().trim().max(40).optional(),
  color: hexColorSchema.optional(),
});

export const categoryUpdateSchema = categorySchema
  .omit({ kind: true })
  .extend({ categoryId: z.string().uuid() });

export const categoryIdSchema = z.object({ categoryId: z.string().uuid() });

export const subcategorySchema = z.object({
  categoryId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da subcategoria.")
    .max(60, "Nome muito longo."),
});

export const subcategoryUpdateSchema = z.object({
  subcategoryId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da subcategoria.")
    .max(60, "Nome muito longo."),
});

export const subcategoryIdSchema = z.object({
  subcategoryId: z.string().uuid(),
});

export const reorderCategorySchema = z.object({
  categoryId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

export type AccountInput = z.input<typeof accountSchema>;
export type CategoryInput = z.input<typeof categorySchema>;
