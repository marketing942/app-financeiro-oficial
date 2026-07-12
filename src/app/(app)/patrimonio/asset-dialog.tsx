"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { createAsset } from "@/server/assets/actions";
import { ASSET_TYPE_LABELS, type AssetType } from "@/lib/finance/assets";
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
  name: z.string().trim().min(1, "Informe o nome.").max(100),
  purchaseValue: z.string().trim().min(1, "Informe o valor."),
  purchaseDate: z.string(),
  ownershipPercent: z.string(),
  note: z.string().trim().max(500),
});

type FormInput = z.infer<typeof formSchema>;
type Option = { id: string; name: string };

export function AssetDialog({ liabilities }: { liabilities: Option[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AssetType>("property");
  const [liabilityId, setLiabilityId] = useState("");
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      purchaseValue: "",
      purchaseDate: "",
      ownershipPercent: "100",
      note: "",
    },
  });

  function onSubmit(values: FormInput) {
    setServerError(undefined);
    startTransition(async () => {
      const result = await createAsset({ ...values, type, liabilityId });
      if ("error" in result) {
        setServerError(result.error);
      } else {
        toast.success("Ativo cadastrado.");
        setOpen(false);
        form.reset();
        setLiabilityId("");
      }
    });
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Novo ativo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo ativo</DialogTitle>
          <DialogDescription>
            O valor de compra fica registrado para sempre — o valor atual muda
            só por novas avaliações, mantendo a variação visível.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-name">Nome</Label>
            <Input
              id="asset-name"
              placeholder="Ex.: Apartamento Centro, Carro…"
              aria-invalid={!!errors.name}
              {...form.register("name")}
            />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Tipo</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as AssetType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {ASSET_TYPE_LABELS[value]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-ownership">Sua participação (%)</Label>
              <Input
                id="asset-ownership"
                inputMode="decimal"
                {...form.register("ownershipPercent")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-value">Valor de compra (R$)</Label>
              <Input
                id="asset-value"
                inputMode="decimal"
                placeholder="0,00"
                aria-invalid={!!errors.purchaseValue}
                {...form.register("purchaseValue")}
              />
              {errors.purchaseValue && (
                <p className="text-destructive text-sm">
                  {errors.purchaseValue.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-date">Data de compra (opcional)</Label>
              <Input
                id="asset-date"
                type="date"
                {...form.register("purchaseDate")}
              />
            </div>
          </div>

          {liabilities.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Dívida vinculada (opcional)</Label>
              <Select value={liabilityId} onValueChange={setLiabilityId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Ex.: financiamento deste bem" />
                </SelectTrigger>
                <SelectContent>
                  {liabilities.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-note">Observação (opcional)</Label>
            <Input id="asset-note" {...form.register("note")} />
          </div>

          {serverError && (
            <p role="alert" className="text-destructive text-sm">
              {serverError}
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Cadastrar ativo
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
