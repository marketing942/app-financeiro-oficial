"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronUp, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createExpense } from "@/server/transactions/actions";
import {
  createExpenseSchema,
  type CreateExpenseInput,
} from "@/lib/validation/transactions";
import {
  PAYMENT_METHOD_LABELS,
  PIX_KEY_TYPE_LABELS,
  RECURRENCE_LABELS,
  type PaymentMethodKind,
  type RecurrenceOption,
} from "@/lib/finance/labels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CategoryOption = {
  id: string;
  name: string;
  subcategories: { id: string; name: string }[];
};
type Option = { id: string; name: string };

export function ExpenseDialog({
  categories,
  accounts,
}: {
  categories: CategoryOption[];
  accounts: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [recurrence, setRecurrence] = useState<RecurrenceOption>("none");
  const [showPayment, setShowPayment] = useState(false);
  const [method, setMethod] = useState<string>("");
  const [pixKeyType, setPixKeyType] = useState<string>("");
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const form = useForm<CreateExpenseInput>({
    resolver: zodResolver(createExpenseSchema),
    defaultValues: {
      description: "",
      categoryId: "",
      plannedAmount: "",
      dueDate: new Date().toISOString().slice(0, 10),
      recurrence: "none",
      note: "",
      paymentInstruction: {},
    },
  });

  const subcategories = useMemo(
    () => categories.find((c) => c.id === categoryId)?.subcategories ?? [],
    [categories, categoryId]
  );

  function onSubmit(values: CreateExpenseInput) {
    setServerError(undefined);
    if (!categoryId) {
      setServerError("Escolha a categoria da despesa.");
      return;
    }
    startTransition(async () => {
      const result = await createExpense({
        ...values,
        categoryId,
        subcategoryId,
        accountId,
        recurrence,
        paymentInstruction: showPayment
          ? {
              ...values.paymentInstruction,
              method: method || undefined,
              pixKeyType: pixKeyType || undefined,
            }
          : undefined,
      });
      if ("error" in result) {
        setServerError(result.error);
      } else {
        toast.success("Despesa registrada.");
        setOpen(false);
        form.reset();
        setCategoryId("");
        setSubcategoryId("");
        setRecurrence("none");
        setShowPayment(false);
      }
    });
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Nova despesa
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova despesa</DialogTitle>
          <DialogDescription>
            Única, recorrente ou parcelada. Dados de pagamento (Pix, boleto,
            banco) são opcionais e ficam mascarados na listagem.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="expense-desc">Descrição</Label>
            <Input
              id="expense-desc"
              placeholder="Ex.: Conta de luz, Mercado…"
              aria-invalid={!!errors.description}
              {...form.register("description")}
            />
            {errors.description && (
              <p className="text-destructive text-sm">
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Categoria</Label>
              <Select
                value={categoryId}
                onValueChange={(v) => {
                  setCategoryId(v);
                  setSubcategoryId("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolher categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Subcategoria (opcional)</Label>
              <Select
                value={subcategoryId}
                onValueChange={setSubcategoryId}
                disabled={subcategories.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={subcategories.length === 0 ? "—" : "Escolher"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {subcategories.map((sub) => (
                    <SelectItem key={sub.id} value={sub.id}>
                      {sub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="expense-amount">Valor previsto (R$)</Label>
              <Input
                id="expense-amount"
                inputMode="decimal"
                placeholder="0,00"
                aria-invalid={!!errors.plannedAmount}
                {...form.register("plannedAmount")}
              />
              {errors.plannedAmount && (
                <p className="text-destructive text-sm">
                  {errors.plannedAmount.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="expense-due">Vencimento</Label>
              <Input
                id="expense-due"
                type="date"
                aria-invalid={!!errors.dueDate}
                {...form.register("dueDate")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Conta de saída</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Repetição</Label>
              <Select
                value={recurrence}
                onValueChange={(v) => setRecurrence(v as RecurrenceOption)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RECURRENCE_LABELS) as RecurrenceOption[]).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {RECURRENCE_LABELS[value]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            {recurrence === "installment" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="expense-count">Nº de parcelas</Label>
                <Input
                  id="expense-count"
                  type="number"
                  min={2}
                  max={480}
                  aria-invalid={!!errors.installmentCount}
                  {...form.register("installmentCount")}
                />
                {errors.installmentCount && (
                  <p className="text-destructive text-sm">
                    {errors.installmentCount.message}
                  </p>
                )}
              </div>
            )}
          </div>
          {recurrence === "installment" && (
            <p className="text-muted-foreground text-xs">
              No parcelamento, o valor informado é o TOTAL da compra; as
              parcelas mensais são geradas automaticamente.
            </p>
          )}

          <button
            type="button"
            className="text-primary flex items-center gap-1 self-start text-xs underline-offset-4 hover:underline"
            onClick={() => setShowPayment((v) => !v)}
          >
            {showPayment ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
            Dados de pagamento (opcional)
          </button>

          {showPayment && (
            <fieldset className="flex flex-col gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                Como pagar (nunca armazene senha, CVV ou nº completo de cartão)
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label>Forma de pagamento</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Escolher" />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.keys(
                          PAYMENT_METHOD_LABELS
                        ) as PaymentMethodKind[]
                      ).map((value) => (
                        <SelectItem key={value} value={value}>
                          {PAYMENT_METHOD_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pi-payee">Favorecido</Label>
                  <Input
                    id="pi-payee"
                    {...form.register("paymentInstruction.payee")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Tipo de chave Pix</Label>
                  <Select value={pixKeyType} onValueChange={setPixKeyType}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Escolher" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PIX_KEY_TYPE_LABELS).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pi-pix">Chave Pix</Label>
                  <Input
                    id="pi-pix"
                    {...form.register("paymentInstruction.pixKey")}
                  />
                </div>
                <div className="col-span-full flex flex-col gap-1">
                  <Label htmlFor="pi-line">Linha digitável (boleto)</Label>
                  <Input
                    id="pi-line"
                    {...form.register("paymentInstruction.digitableLine")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pi-bank">Banco</Label>
                  <Input
                    id="pi-bank"
                    {...form.register("paymentInstruction.bankName")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pi-account">Agência / Conta</Label>
                  <div className="flex gap-2">
                    <Input
                      id="pi-branch"
                      placeholder="Agência"
                      aria-label="Agência"
                      {...form.register("paymentInstruction.branchNumber")}
                    />
                    <Input
                      id="pi-account"
                      placeholder="Conta"
                      {...form.register("paymentInstruction.accountNumber")}
                    />
                  </div>
                </div>
              </div>
              {errors.paymentInstruction?.note && (
                <p className="text-destructive text-sm">
                  {errors.paymentInstruction.note.message}
                </p>
              )}
            </fieldset>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="expense-note">Observação (opcional)</Label>
            <Input id="expense-note" {...form.register("note")} />
          </div>

          {serverError && (
            <p role="alert" className="text-destructive text-sm">
              {serverError}
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Registrar despesa
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
