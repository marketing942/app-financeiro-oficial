"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  createInvestment,
  updateInvestment,
} from "@/server/investments/actions";
import {
  INVESTMENT_GROUP_LABELS,
  type Investment,
  type InvestmentGroup,
} from "@/lib/finance/investments";
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

const formSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  subgroup: z.string().trim().max(80).optional(),
  initialAmount: z.string(),
  targetAmount: z.string(),
});

type FormInput = z.infer<typeof formSchema>;
type Option = { id: string; name: string };

export function InvestmentDialog({
  investment,
  accounts,
}: {
  investment?: Investment;
  accounts: Option[];
}) {
  const isEdit = !!investment;
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<InvestmentGroup>(
    investment?.group ?? "long_term"
  );
  const [accountId, setAccountId] = useState(investment?.accountId ?? "");
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: investment?.name ?? "",
      subgroup: investment?.subgroup ?? "",
      initialAmount: investment?.initialAmount.replace(".", ",") ?? "0,00",
      targetAmount: investment?.targetAmount?.replace(".", ",") ?? "",
    },
  });

  function onSubmit(values: FormInput) {
    setServerError(undefined);
    startTransition(async () => {
      const payload = { ...values, group, accountId };
      const result = isEdit
        ? await updateInvestment({ ...payload, investmentId: investment.id })
        : await createInvestment(payload);
      if ("error" in result) {
        setServerError(result.error);
      } else {
        toast.success(
          isEdit ? "Investimento atualizado." : "Investimento criado."
        );
        setOpen(false);
        if (!isEdit) form.reset();
      }
    });
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Editar ${investment.name}`}
          >
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus />
            Novo investimento
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Editar “${investment.name}”` : "Novo investimento"}
          </DialogTitle>
          <DialogDescription>
            O saldo cresce pelos aportes registrados — cada aporte sai de uma
            conta e entra aqui, sem contar como despesa.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-name">Nome</Label>
            <Input
              id="inv-name"
              placeholder="Ex.: Reserva CDB, Carteira de FIIs…"
              aria-invalid={!!errors.name}
              {...form.register("name")}
            />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Grupo</Label>
              <Select
                value={group}
                onValueChange={(v) => setGroup(v as InvestmentGroup)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(INVESTMENT_GROUP_LABELS) as InvestmentGroup[]
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {INVESTMENT_GROUP_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="inv-subgroup">Objetivo/carteira (opcional)</Label>
              <Input id="inv-subgroup" {...form.register("subgroup")} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!isEdit && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="inv-initial">Saldo inicial (R$)</Label>
                <Input
                  id="inv-initial"
                  inputMode="decimal"
                  {...form.register("initialAmount")}
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="inv-target">Meta (R$, opcional)</Label>
              <Input
                id="inv-target"
                inputMode="decimal"
                placeholder="0,00"
                {...form.register("targetAmount")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Conta relacionada (opcional)</Label>
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

          {serverError && (
            <p role="alert" className="text-destructive text-sm">
              {serverError}
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "Salvar" : "Criar investimento"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
