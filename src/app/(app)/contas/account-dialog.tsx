"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { createAccount, updateAccount } from "@/server/accounts/actions";
import type { FinancialAccount } from "@/server/accounts/queries";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  accountSchema,
  type AccountInput,
} from "@/lib/validation/finance";
import { COLOR_PALETTE } from "@/lib/icons";
import { cn } from "@/lib/utils";
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

export function AccountDialog({ account }: { account?: FinancialAccount }) {
  const isEdit = !!account;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>(account?.type ?? "checking");
  const [color, setColor] = useState<string | undefined>(
    account?.color ?? undefined
  );
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const form = useForm<AccountInput>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: account?.name ?? "",
      type: account?.type ?? "checking",
      institution: account?.institution ?? "",
      initialBalance: account?.initialBalance.replace(".", ",") ?? "0,00",
      creditLimit: account?.creditLimit?.replace(".", ",") ?? "",
      note: account?.note ?? "",
    },
  });

  function onSubmit(values: AccountInput) {
    setServerError(undefined);
    const payload = { ...values, type, color };
    startTransition(async () => {
      const result = isEdit
        ? await updateAccount({ ...payload, accountId: account.id })
        : await createAccount(payload);
      if ("error" in result) {
        setServerError(result.error);
      } else {
        toast.success(isEdit ? "Conta atualizada." : "Conta criada.");
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
            aria-label={`Editar conta ${account.name}`}
          >
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus />
            Nova conta
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar conta" : "Nova conta"}</DialogTitle>
          <DialogDescription>
            Contas representam onde o dinheiro está. O saldo será calculado
            automaticamente a partir dos lançamentos.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-name">Nome</Label>
            <Input
              id="account-name"
              placeholder="Ex.: Banco principal"
              aria-invalid={!!errors.name}
              {...form.register("name")}
            />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="account-type">Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="account-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ACCOUNT_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="account-institution">Instituição</Label>
              <Input
                id="account-institution"
                placeholder="Opcional"
                {...form.register("institution")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="account-balance">Saldo inicial (R$)</Label>
              <Input
                id="account-balance"
                inputMode="decimal"
                aria-invalid={!!errors.initialBalance}
                {...form.register("initialBalance")}
              />
              {errors.initialBalance && (
                <p className="text-destructive text-sm">
                  {errors.initialBalance.message}
                </p>
              )}
            </div>
            {type === "credit_card" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="account-limit">Limite (R$)</Label>
                <Input
                  id="account-limit"
                  inputMode="decimal"
                  placeholder="Opcional"
                  aria-invalid={!!errors.creditLimit}
                  {...form.register("creditLimit")}
                />
                {errors.creditLimit && (
                  <p className="text-destructive text-sm">
                    {errors.creditLimit.message}
                  </p>
                )}
              </div>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Cor</legend>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Cor ${hex}`}
                  aria-pressed={color === hex}
                  onClick={() => setColor(color === hex ? undefined : hex)}
                  className={cn(
                    "size-6 rounded-full border-2 transition-transform",
                    color === hex
                      ? "border-foreground scale-110"
                      : "border-transparent"
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor="account-note">Observação</Label>
            <Input
              id="account-note"
              placeholder="Opcional"
              {...form.register("note")}
            />
          </div>

          {serverError && (
            <p role="alert" className="text-destructive text-sm">
              {serverError}
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "Salvar conta" : "Criar conta"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
