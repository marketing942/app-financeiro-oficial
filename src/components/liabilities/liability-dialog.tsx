"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { createLiability } from "@/server/liabilities/actions";
import {
  PURPOSE_LABELS,
  type PurposeClassification,
} from "@/lib/finance/liabilities";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  name: z.string().trim().min(1, "Informe o nome.").max(100),
  creditor: z.string().trim().max(100).optional(),
  originalAmount: z.string().min(1, "Informe o valor."),
  installmentCount: z.string().optional(),
  installmentAmount: z.string().optional(),
  firstDueDate: z.string().optional(),
  note: z.string().trim().max(500).optional(),
});

type FormInput = z.infer<typeof formSchema>;

export function LiabilityDialog({
  defaultPurpose = "personal_consumption",
}: {
  defaultPurpose?: PurposeClassification;
}) {
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<PurposeClassification>(defaultPurpose);
  const [createSchedule, setCreateSchedule] = useState(true);
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      creditor: "",
      originalAmount: "",
      installmentCount: "",
      installmentAmount: "",
      firstDueDate: "",
      note: "",
    },
  });

  function onSubmit(values: FormInput) {
    setServerError(undefined);
    startTransition(async () => {
      const result = await createLiability({
        ...values,
        purpose,
        installmentCount: values.installmentCount
          ? Number(values.installmentCount)
          : undefined,
        createSchedule,
      });
      if ("error" in result) {
        setServerError(result.error);
      } else {
        toast.success("Dívida registrada.");
        setOpen(false);
        form.reset();
      }
    });
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Nova dívida
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova dívida / financiamento</DialogTitle>
          <DialogDescription>
            A finalidade decide a regra 50/20/30: somente “consumo próprio”
            entra nos 20%. Investimento e projeto comercial ficam fora.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="liab-name">Nome</Label>
              <Input
                id="liab-name"
                placeholder="Ex.: Financiamento do carro"
                aria-invalid={!!errors.name}
                {...form.register("name")}
              />
              {errors.name && (
                <p className="text-destructive text-sm">
                  {errors.name.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="liab-creditor">Credor</Label>
              <Input
                id="liab-creditor"
                placeholder="Opcional"
                {...form.register("creditor")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Finalidade</Label>
              <Select
                value={purpose}
                onValueChange={(v) => setPurpose(v as PurposeClassification)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PURPOSE_LABELS) as PurposeClassification[]).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {PURPOSE_LABELS[value]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="liab-original">Valor total devido (R$)</Label>
              <Input
                id="liab-original"
                inputMode="decimal"
                placeholder="0,00"
                aria-invalid={!!errors.originalAmount}
                {...form.register("originalAmount")}
              />
              {errors.originalAmount && (
                <p className="text-destructive text-sm">
                  {errors.originalAmount.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="liab-count">Nº de parcelas</Label>
              <Input
                id="liab-count"
                type="number"
                min={1}
                max={600}
                placeholder="Opcional"
                {...form.register("installmentCount")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="liab-installment">Valor da parcela (R$)</Label>
              <Input
                id="liab-installment"
                inputMode="decimal"
                placeholder="Opcional"
                {...form.register("installmentAmount")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="liab-first">Próximo vencimento</Label>
              <Input
                id="liab-first"
                type="date"
                {...form.register("firstDueDate")}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={createSchedule}
              onCheckedChange={(checked) => setCreateSchedule(checked === true)}
            />
            Gerar cronograma de parcelas automaticamente (requer nº de parcelas,
            valor e vencimento)
          </label>

          {serverError && (
            <p role="alert" className="text-destructive text-sm">
              {serverError}
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Registrar dívida
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
