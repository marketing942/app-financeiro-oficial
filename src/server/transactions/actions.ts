"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  createExpenseSchema,
  createIncomeSchema,
  markRealizedSchema,
  postponeSchema,
  transactionIdSchema,
} from "@/lib/validation/transactions";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";
const PATHS = ["/receitas", "/despesas"];

type ActionResult = { error: string } | { success: true };

async function requireMemberContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { active } = await getActiveWorkspace();
  if (!active) return null;
  return { supabase, user, workspace: active };
}

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
}

function monthOf(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}

function emptyToNull(value: string | undefined | null): string | null {
  return value ? value : null;
}

const FREQUENCY_HORIZON_MONTHS = 12;

type SeriesConfig = {
  recurrence: string;
  installmentCount?: number;
};

// Cria série + materializa ocorrências (idempotente no banco).
async function createSeries(
  ctx: NonNullable<Awaited<ReturnType<typeof requireMemberContext>>>,
  base: Record<string, unknown>,
  config: SeriesConfig,
  totalAmount: string | null
): Promise<{ error?: string }> {
  const isInstallment = config.recurrence === "installment";

  const { data: series, error } = await ctx.supabase
    .from("transaction_series")
    .insert({
      ...base,
      kind: isInstallment ? "installment" : "recurring",
      frequency: isInstallment ? "monthly" : config.recurrence,
      total_amount: isInstallment ? totalAmount : null,
      installment_count: isInstallment ? config.installmentCount : null,
    })
    .select("id, first_due_date")
    .single();

  if (error || !series) return { error: GENERIC_ERROR };

  const first = new Date(`${series.first_due_date}T12:00:00Z`);
  const horizon = new Date(first);
  if (isInstallment) {
    horizon.setUTCMonth(horizon.getUTCMonth() + (config.installmentCount ?? 1));
  } else {
    horizon.setUTCMonth(horizon.getUTCMonth() + FREQUENCY_HORIZON_MONTHS);
  }

  const { error: genError } = await ctx.supabase.rpc(
    "generate_series_transactions",
    {
      p_series_id: series.id,
      p_until: horizon.toISOString().slice(0, 10),
    }
  );
  if (genError) return { error: GENERIC_ERROR };
  return {};
}

export async function createExpense(input: unknown): Promise<ActionResult> {
  const parsed = createExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Dados inválidos. Revise os campos.",
    };
  }
  const ctx = await requireMemberContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const d = parsed.data;

  // Instrução de pagamento opcional (criada antes, vinculada depois).
  let paymentInstructionId: string | null = null;
  const pi = d.paymentInstruction;
  const hasInstruction =
    pi && Object.values(pi).some((value) => value && value !== "");
  if (hasInstruction) {
    const { data: instruction, error } = await ctx.supabase
      .from("payment_instructions")
      .insert({
        workspace_id: ctx.workspace.id,
        method: pi.method ?? null,
        payee: emptyToNull(pi.payee),
        pix_key_type: pi.pixKeyType ?? null,
        pix_key: emptyToNull(pi.pixKey),
        bank_name: emptyToNull(pi.bankName),
        bank_code: emptyToNull(pi.bankCode),
        branch_number: emptyToNull(pi.branchNumber),
        account_number: emptyToNull(pi.accountNumber),
        digitable_line: emptyToNull(pi.digitableLine),
        payment_link: emptyToNull(pi.paymentLink),
        note: emptyToNull(pi.note),
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error || !instruction) return { error: GENERIC_ERROR };
    paymentInstructionId = instruction.id;
  }

  const common = {
    workspace_id: ctx.workspace.id,
    nature: "consumer_expense",
    description: d.description,
    category_id: d.categoryId,
    subcategory_id: emptyToNull(d.subcategoryId),
    account_id: emptyToNull(d.accountId),
    payment_instruction_id: paymentInstructionId,
    note: emptyToNull(d.note),
    created_by: ctx.user.id,
  };

  if (d.recurrence === "none") {
    const { data, error } = await ctx.supabase
      .from("transactions")
      .insert({
        ...common,
        planned_amount: d.plannedAmount,
        competence_month: monthOf(d.dueDate),
        due_date: d.dueDate,
        status: "planned",
      })
      .select("id")
      .single();
    if (error || !data) return { error: GENERIC_ERROR };

    await ctx.supabase.from("audit_logs").insert({
      workspace_id: ctx.workspace.id,
      user_id: ctx.user.id,
      action: "transaction.created",
      entity_type: "transaction",
      entity_id: data.id,
      summary: `Despesa "${d.description}" criada`,
    });
  } else {
    const result = await createSeries(
      ctx,
      {
        ...common,
        nature: "consumer_expense",
        planned_amount: d.recurrence === "installment" ? null : d.plannedAmount,
        first_due_date: d.dueDate,
      },
      { recurrence: d.recurrence, installmentCount: d.installmentCount },
      d.plannedAmount
    );
    if (result.error) return { error: result.error };

    await ctx.supabase.from("audit_logs").insert({
      workspace_id: ctx.workspace.id,
      user_id: ctx.user.id,
      action: "series.created",
      entity_type: "transaction_series",
      summary: `Série de despesa "${d.description}" criada`,
    });
  }

  revalidateAll();
  return { success: true };
}

export async function createIncome(input: unknown): Promise<ActionResult> {
  const parsed = createIncomeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Dados inválidos. Revise os campos.",
    };
  }
  const ctx = await requireMemberContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const d = parsed.data;
  const usesGross = !!d.grossPlanned;

  const amounts = usesGross
    ? {
        gross_amount_planned: d.grossPlanned,
        tax_amount_planned: d.taxPlanned || "0",
        social_security_amount_planned: d.socialSecurityPlanned || "0",
        fee_amount_planned: d.feePlanned || "0",
        commission_amount_planned: d.commissionPlanned || "0",
        other_deductions_amount_planned: d.otherDeductionsPlanned || "0",
      }
    : { planned_amount: d.plannedAmount };

  const common = {
    workspace_id: ctx.workspace.id,
    nature: "income",
    description: d.description,
    income_class: d.incomeClass,
    category_id: emptyToNull(d.categoryId),
    account_id: emptyToNull(d.accountId),
    note: emptyToNull(d.note),
    created_by: ctx.user.id,
  };

  if (d.recurrence === "none") {
    const { data, error } = await ctx.supabase
      .from("transactions")
      .insert({
        ...common,
        ...amounts,
        competence_month: monthOf(d.dueDate),
        due_date: d.dueDate,
        status: "planned",
      })
      .select("id")
      .single();
    if (error || !data) return { error: GENERIC_ERROR };

    await ctx.supabase.from("audit_logs").insert({
      workspace_id: ctx.workspace.id,
      user_id: ctx.user.id,
      action: "transaction.created",
      entity_type: "transaction",
      entity_id: data.id,
      summary: `Receita "${d.description}" criada`,
    });
  } else {
    const result = await createSeries(
      ctx,
      {
        ...common,
        ...(d.recurrence === "installment" && !usesGross ? {} : amounts),
        first_due_date: d.dueDate,
      },
      { recurrence: d.recurrence, installmentCount: d.installmentCount },
      d.plannedAmount || d.grossPlanned || null
    );
    if (result.error) return { error: result.error };

    await ctx.supabase.from("audit_logs").insert({
      workspace_id: ctx.workspace.id,
      user_id: ctx.user.id,
      action: "series.created",
      entity_type: "transaction_series",
      summary: `Série de receita "${d.description}" criada`,
    });
  }

  revalidateAll();
  return { success: true };
}

// Marca recebido/pago (total ou parcial). O planejado nunca é alterado.
export async function markRealized(input: unknown): Promise<ActionResult> {
  const parsed = markRealizedSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }
  const ctx = await requireMemberContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const d = parsed.data;

  if (d.partial) {
    const { error } = await ctx.supabase
      .from("transaction_installments")
      .insert({
        workspace_id: ctx.workspace.id,
        transaction_id: d.transactionId,
        amount: d.amount,
        paid_at: d.date,
        created_by: ctx.user.id,
      });
    if (error) return { error: GENERIC_ERROR };
  } else {
    const update: Record<string, unknown> = {
      realized_date: d.date,
      status: "realized",
      updated_by: ctx.user.id,
    };
    if (d.grossActual) {
      update.gross_amount_actual = d.grossActual;
      update.tax_amount_actual = d.taxActual || "0";
      update.social_security_amount_actual = d.socialSecurityActual || "0";
      update.fee_amount_actual = d.feeActual || "0";
      update.commission_amount_actual = d.commissionActual || "0";
      update.other_deductions_amount_actual = d.otherDeductionsActual || "0";
    } else {
      update.actual_amount = d.amount;
    }

    const { data, error } = await ctx.supabase
      .from("transactions")
      .update(update)
      .eq("id", d.transactionId)
      .eq("workspace_id", ctx.workspace.id)
      .select("id")
      .maybeSingle();
    if (error || !data) return { error: GENERIC_ERROR };
  }

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: d.partial
      ? "transaction.partially_realized"
      : "transaction.realized",
    entity_type: "transaction",
    entity_id: d.transactionId,
    summary: d.partial
      ? "Recebimento/pagamento parcial registrado"
      : "Lançamento marcado como realizado",
  });

  revalidateAll();
  return { success: true };
}

async function setStatus(
  transactionId: string,
  status: string,
  auditAction: string,
  auditSummary: string,
  extra: Record<string, unknown> = {}
): Promise<ActionResult> {
  const ctx = await requireMemberContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const { data, error } = await ctx.supabase
    .from("transactions")
    .update({ status, updated_by: ctx.user.id, ...extra })
    .eq("id", transactionId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: auditAction,
    entity_type: "transaction",
    entity_id: transactionId,
    summary: auditSummary,
  });

  revalidateAll();
  return { success: true };
}

export async function setNoDemand(input: unknown): Promise<ActionResult> {
  const parsed = transactionIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  return setStatus(
    parsed.data.transactionId,
    "no_demand",
    "transaction.no_demand",
    "Despesa marcada como sem demanda"
  );
}

export async function reactivateTransaction(
  input: unknown
): Promise<ActionResult> {
  const parsed = transactionIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  return setStatus(
    parsed.data.transactionId,
    "planned",
    "transaction.reactivated",
    "Lançamento reativado"
  );
}

export async function cancelTransaction(input: unknown): Promise<ActionResult> {
  const parsed = transactionIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  return setStatus(
    parsed.data.transactionId,
    "canceled",
    "transaction.canceled",
    "Lançamento cancelado"
  );
}

export async function postponeTransaction(
  input: unknown
): Promise<ActionResult> {
  const parsed = postponeSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  const ctx = await requireMemberContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const { data, error } = await ctx.supabase
    .from("transactions")
    .update({
      due_date: parsed.data.dueDate,
      competence_month: monthOf(parsed.data.dueDate),
      status: "planned",
      updated_by: ctx.user.id,
    })
    .eq("id", parsed.data.transactionId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "transaction.postponed",
    entity_type: "transaction",
    entity_id: parsed.data.transactionId,
    summary: `Vencimento adiado para ${parsed.data.dueDate}`,
  });

  revalidateAll();
  return { success: true };
}

export async function duplicateTransaction(
  input: unknown
): Promise<ActionResult> {
  const parsed = transactionIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  const ctx = await requireMemberContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const { data: original } = await ctx.supabase
    .from("transactions")
    .select(
      `workspace_id, nature, description, category_id, subcategory_id,
       account_id, income_class, purpose_classification, planned_amount,
       gross_amount_planned, tax_amount_planned, social_security_amount_planned,
       fee_amount_planned, commission_amount_planned,
       other_deductions_amount_planned, competence_month, due_date,
       payment_method_id, payment_instruction_id, note`
    )
    .eq("id", parsed.data.transactionId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!original) return { error: GENERIC_ERROR };

  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert({
      ...original,
      description: `${original.description} (cópia)`,
      status: "planned",
      origin: "manual",
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "transaction.duplicated",
    entity_type: "transaction",
    entity_id: data.id,
    summary: `Lançamento duplicado de ${parsed.data.transactionId}`,
  });

  revalidateAll();
  return { success: true };
}

export async function deleteTransaction(input: unknown): Promise<ActionResult> {
  const parsed = transactionIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };
  const ctx = await requireMemberContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const { data, error } = await ctx.supabase.rpc("soft_delete_transaction", {
    p_id: parsed.data.transactionId,
  });

  if (error) {
    if (error.message.includes("not_authorized")) {
      return {
        error: "Você não tem permissão para excluir lançamentos.",
      };
    }
    return { error: GENERIC_ERROR };
  }
  if (!data) return { error: GENERIC_ERROR };

  revalidateAll();
  return { success: true };
}

export type RevealedInstruction = {
  pixKey: string | null;
  digitableLine: string | null;
  bankName: string | null;
  bankCode: string | null;
  branchNumber: string | null;
  accountNumber: string | null;
  payee: string | null;
  paymentLink: string | null;
};

// Dados completos de pagamento: auditado no banco; exige permissão.
export async function revealPaymentInstruction(
  instructionId: string
): Promise<{ error: string } | { success: true; data: RevealedInstruction }> {
  const ctx = await requireMemberContext();
  if (!ctx) return { error: GENERIC_ERROR };

  const { data, error } = await ctx.supabase.rpc("reveal_payment_instruction", {
    p_id: instructionId,
  });

  if (error) {
    if (error.message.includes("not_authorized")) {
      return {
        error: "Você não tem permissão para ver os dados completos.",
      };
    }
    return { error: GENERIC_ERROR };
  }

  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return { error: GENERIC_ERROR };

  return {
    success: true,
    data: {
      pixKey: (row.pix_key as string) ?? null,
      digitableLine: (row.digitable_line as string) ?? null,
      bankName: (row.bank_name as string) ?? null,
      bankCode: (row.bank_code as string) ?? null,
      branchNumber: (row.branch_number as string) ?? null,
      accountNumber: (row.account_number as string) ?? null,
      payee: (row.payee as string) ?? null,
      paymentLink: (row.payment_link as string) ?? null,
    },
  };
}
