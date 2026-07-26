"use client";

import { useState, useTransition } from "react";
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  MoreVertical,
  PauseCircle,
  Pencil,
  PlayCircle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  cancelTransaction,
  deleteTransaction,
  duplicateTransaction,
  markRealized,
  postponeTransaction,
  reactivateTransaction,
  revealPaymentInstruction,
  setNoDemand,
} from "@/server/transactions/actions";
import type { TransactionRow } from "@/server/transactions/queries";
import { parseMoneyInput } from "@/lib/finance/money";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ExpenseDialog,
  type CategoryOption,
  type Option,
} from "@/app/(app)/despesas/expense-dialog";
import { IncomeDialog } from "@/app/(app)/receitas/income-dialog";

type Kind = "income" | "expense";

export function TransactionActions({
  row,
  kind,
  expenseCategories,
  incomeCategories,
  accounts,
}: {
  row: TransactionRow;
  kind: Kind;
  // Opções para o diálogo de edição (só quando a edição está habilitada).
  expenseCategories?: CategoryOption[];
  incomeCategories?: Option[];
  accounts?: Option[];
}) {
  const [realizeOpen, setRealizeOpen] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [amount, setAmount] = useState(
    (row.plannedAmount ?? "0").replace(".", ",")
  );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [partial, setPartial] = useState(false);
  const [newDueDate, setNewDueDate] = useState(row.dueDate ?? "");
  const [isPending, startTransition] = useTransition();

  const realizeVerb = kind === "income" ? "Receber" : "Pagar";
  const isOpenStatus = [
    "planned",
    "pending",
    "overdue",
    "partially_realized",
  ].includes(row.status);
  const canEdit =
    isOpenStatus &&
    ((kind === "expense" && !!expenseCategories && !!accounts) ||
      (kind === "income" && !!incomeCategories && !!accounts));

  function run(
    action: () => Promise<{ error: string } | { success: true }>,
    successMessage: string,
    close?: () => void
  ) {
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(successMessage);
        close?.();
      }
    });
  }

  function submitRealize() {
    const parsed = parseMoneyInput(amount);
    if (!parsed) {
      toast.error("Informe um valor válido.");
      return;
    }
    run(
      () =>
        markRealized({
          transactionId: row.id,
          amount: parsed,
          date,
          partial,
        }),
      partial
        ? "Valor parcial registrado."
        : kind === "income"
          ? "Receita marcada como recebida."
          : "Despesa marcada como paga.",
      () => setRealizeOpen(false)
    );
  }

  async function copyPaymentData() {
    if (!row.paymentInstructionId) return;
    const result = await revealPaymentInstruction(row.paymentInstructionId);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    const d = result.data;
    const text =
      d.pixKey ??
      d.digitableLine ??
      [d.bankName, d.bankCode, d.branchNumber, d.accountNumber, d.payee]
        .filter(Boolean)
        .join(" · ");
    if (!text) {
      toast.error("Sem dados copiáveis nesta instrução.");
      return;
    }
    await navigator.clipboard.writeText(text);
    toast.success("Dados de pagamento copiados (acesso auditado).");
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {isOpenStatus && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRealizeOpen(true)}
          >
            <CheckCircle2 />
            {realizeVerb}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Ações de ${row.description}`}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil />
                Editar
              </DropdownMenuItem>
            )}
            {isOpenStatus && (
              <DropdownMenuItem onSelect={() => setPostponeOpen(true)}>
                <CalendarClock />
                Adiar vencimento
              </DropdownMenuItem>
            )}
            {kind === "expense" && isOpenStatus && (
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () => setNoDemand({ transactionId: row.id }),
                    "Marcada como sem demanda."
                  )
                }
              >
                <PauseCircle />
                Sem demanda
              </DropdownMenuItem>
            )}
            {(row.status === "no_demand" || row.status === "canceled") && (
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () => reactivateTransaction({ transactionId: row.id }),
                    "Lançamento reativado."
                  )
                }
              >
                <PlayCircle />
                Reativar
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() =>
                run(
                  () => duplicateTransaction({ transactionId: row.id }),
                  "Lançamento duplicado."
                )
              }
            >
              <Copy />
              Duplicar
            </DropdownMenuItem>
            {row.paymentInstructionId && (
              <DropdownMenuItem onSelect={copyPaymentData}>
                <CreditCard />
                Copiar dados de pagamento
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {isOpenStatus && (
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () => cancelTransaction({ transactionId: row.id }),
                    "Lançamento cancelado."
                  )
                }
              >
                <Ban />
                Cancelar
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2 />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Editar lançamento previsto */}
      {canEdit && kind === "expense" && expenseCategories && accounts && (
        <ExpenseDialog
          categories={expenseCategories}
          accounts={accounts}
          transaction={row}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      {canEdit && kind === "income" && incomeCategories && accounts && (
        <IncomeDialog
          categories={incomeCategories}
          accounts={accounts}
          transaction={row}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}

      {/* Receber/Pagar (total ou parcial) */}
      <Dialog open={realizeOpen} onOpenChange={setRealizeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {realizeVerb} “{row.description}”
            </DialogTitle>
            <DialogDescription>
              O valor planejado é preservado; você registra o que realmente{" "}
              {kind === "income" ? "entrou" : "saiu"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`amount-${row.id}`}>Valor (R$)</Label>
              <Input
                id={`amount-${row.id}`}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`date-${row.id}`}>Data</Label>
              <Input
                id={`date-${row.id}`}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={partial}
              onCheckedChange={(checked) => setPartial(checked === true)}
            />
            {kind === "income"
              ? "Recebimento parcial (soma ao já recebido)"
              : "Pagamento parcial (soma ao já pago)"}
          </label>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRealizeOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitRealize} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adiar */}
      <Dialog open={postponeOpen} onOpenChange={setPostponeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adiar “{row.description}”</DialogTitle>
            <DialogDescription>
              A competência acompanha o novo vencimento.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`due-${row.id}`}>Novo vencimento</Label>
            <Input
              id={`due-${row.id}`}
              type="date"
              value={newDueDate}
              onChange={(event) => setNewDueDate(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPostponeOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={isPending || !newDueDate}
              onClick={() =>
                run(
                  () =>
                    postponeTransaction({
                      transactionId: row.id,
                      dueDate: newDueDate,
                    }),
                  "Vencimento adiado.",
                  () => setPostponeOpen(false)
                )
              }
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Adiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir (confirmação; exclusão lógica auditada) */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir “{row.description}”?</DialogTitle>
            <DialogDescription>
              A exclusão é lógica e auditada: o lançamento sai das listas e dos
              cálculos, mas o histórico é preservado. Requer a permissão de
              excluir lançamentos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                run(
                  () => deleteTransaction({ transactionId: row.id }),
                  "Lançamento excluído.",
                  () => setDeleteOpen(false)
                )
              }
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
