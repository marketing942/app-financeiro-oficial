"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { createProject } from "@/server/projects/actions";
import { PROJECT_TYPE_LABELS, type ProjectType } from "@/lib/finance/projects";
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
  description: z.string().trim().max(1000),
  startDate: z.string(),
  expectedEndDate: z.string(),
  budget: z.string(),
  expectedSaleValue: z.string(),
});

type FormInput = z.infer<typeof formSchema>;

export function ProjectDialog() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ProjectType>("construction_for_sale");
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      startDate: "",
      expectedEndDate: "",
      budget: "",
      expectedSaleValue: "",
    },
  });

  function onSubmit(values: FormInput) {
    setServerError(undefined);
    startTransition(async () => {
      const result = await createProject({ ...values, type });
      if ("error" in result) {
        setServerError(result.error);
      } else {
        toast.success("Projeto criado com categorias de custo do tipo.");
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
          Novo projeto
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo projeto</DialogTitle>
          <DialogDescription>
            Custos, receitas e aportes ficam separados das suas finanças
            pessoais — sem dupla contabilização.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="proj-name">Nome</Label>
            <Input
              id="proj-name"
              placeholder="Ex.: Casa do Lote 12"
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
                onValueChange={(v) => setType(v as ProjectType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROJECT_TYPE_LABELS) as ProjectType[]).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {PROJECT_TYPE_LABELS[value]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proj-budget">Orçamento (R$, opcional)</Label>
              <Input
                id="proj-budget"
                inputMode="decimal"
                placeholder="0,00"
                {...form.register("budget")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="proj-start">Início (opcional)</Label>
              <Input
                id="proj-start"
                type="date"
                {...form.register("startDate")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proj-end">Previsão de término</Label>
              <Input
                id="proj-end"
                type="date"
                {...form.register("expectedEndDate")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="proj-sale">
              Valor estimado de venda (R$, opcional)
            </Label>
            <Input
              id="proj-sale"
              inputMode="decimal"
              placeholder="0,00"
              {...form.register("expectedSaleValue")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="proj-desc">Descrição (opcional)</Label>
            <Input id="proj-desc" {...form.register("description")} />
          </div>

          {serverError && (
            <p role="alert" className="text-destructive text-sm">
              {serverError}
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Criar projeto
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
