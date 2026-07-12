"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createIncome } from "@/server/transactions/actions";
import {
  createIncomeSchema,
  type CreateIncomeInput,
} from "@/lib/validation/transactions";
import {
  INCOME_CLASS_LABELS,
  RECURRENCE_LABELS,
  type IncomeClass,
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

type Option = { id: string; name: string };

export function IncomeDialog({
  categories,
  accounts,
}: {
  categories: Option[];
  accounts: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [incomeClass, setIncomeClass] = useState<IncomeClass>("active_fixed");
  const [categoryId, setCategoryId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [recurrence, setRecurrence] = useState<RecurrenceOption>("none");
  const [showDeductions, setShowDeductions] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const form = useForm<CreateIncomeInput>({
    resolver: zodResolver(createIncomeSchema),
    defaultValues: {
      description: "",
      incomeClass: "active_fixed",
      plannedAmount: "",
      grossPlanned: "",
      taxPlanned: "",
      socialSecurityPlanned: "",
      feePlanned: "",
      commissionPlanned: "",
      otherDeductionsPlanned: "",
      dueDate: new Date().toISOString().slice(0, 10),
      recurrence: "none",
      note: "",
    },
  });

  function onSubmit(values: CreateIncomeInput) {
    setServerError(undefined);
    startTransition(async () => {
      const result = await createIncome({
        ...values,
        incomeClass,
        categoryId,
        accountId,
        recurrence,
      });
      if ("error" in result) {
        setServerError(result.error);
      } else {
        toast.success("Receita registrada.");
        setOpen(false);
        form.reset();
        setRecurrence("none");
        setShowDeductions(false);
      }
    });
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Nova receita
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova receita</DialogTitle>
          <DialogDescription>
            Informe o líquido esperado — ou detalhe bruto e descontos, e o
            líquido é calculado automaticamente.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="income-desc">Descrição</Label>
            <Input
              id="income-desc"
              placeholder="Ex.: Salário, Comissão, Aluguel…"
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
              <Label>Classificação</Label>
              <Select
                value={incomeClass}
                onValueChange={(v) => setIncomeClass(v as IncomeClass)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(INCOME_CLASS_LABELS) as IncomeClass[]).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {INCOME_CLASS_LABELS[value]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Categoria (opcional)</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sem categoria" />
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
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Conta de recebimento (opcional)</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolher conta" />
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="income-due">Data prevista</Label>
              <Input
                id="income-due"
                type="date"
                aria-invalid={!!errors.dueDate}
                {...form.register("dueDate")}
              />
            </div>
          </div>

          {!showDeductions ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="income-net">Valor líquido previsto (R$)</Label>
              <Input
                id="income-net"
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
              <button
                type="button"
                className="text-primary flex items-center gap-1 self-start text-xs underline-offset-4 hover:underline"
                onClick={() => setShowDeductions(true)}
              >
                <ChevronDown className="size-3" />
                Detalhar bruto e descontos (impostos, previdência, taxas…)
              </button>
            </div>
          ) : (
            <fieldset className="flex flex-col gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                Bruto e descontos previstos
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 flex flex-col gap-1">
                  <Label htmlFor="income-gross">Valor bruto (R$)</Label>
                  <Input
                    id="income-gross"
                    inputMode="decimal"
                    {...form.register("grossPlanned")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="income-tax">Impostos</Label>
                  <Input
                    id="income-tax"
                    inputMode="decimal"
                    placeholder="0,00"
                    {...form.register("taxPlanned")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="income-ss">Previdência</Label>
                  <Input
                    id="income-ss"
                    inputMode="decimal"
                    placeholder="0,00"
                    {...form.register("socialSecurityPlanned")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="income-fee">Taxas</Label>
                  <Input
                    id="income-fee"
                    inputMode="decimal"
                    placeholder="0,00"
                    {...form.register("feePlanned")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="income-comm">Comissões</Label>
                  <Input
                    id="income-comm"
                    inputMode="decimal"
                    placeholder="0,00"
                    {...form.register("commissionPlanned")}
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <Label htmlFor="income-other">Outros descontos</Label>
                  <Input
                    id="income-other"
                    inputMode="decimal"
                    placeholder="0,00"
                    {...form.register("otherDeductionsPlanned")}
                  />
                </div>
              </div>
              <button
                type="button"
                className="text-muted-foreground self-start text-xs underline-offset-4 hover:underline"
                onClick={() => setShowDeductions(false)}
              >
                Voltar para valor líquido simples
              </button>
            </fieldset>
          )}

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
                <Label htmlFor="income-count">Nº de parcelas</Label>
                <Input
                  id="income-count"
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
              No parcelamento, o valor informado é o TOTAL; as parcelas são
              geradas automaticamente (a última absorve o arredondamento).
            </p>
          )}

          {serverError && (
            <p role="alert" className="text-destructive text-sm">
              {serverError}
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Registrar receita
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
