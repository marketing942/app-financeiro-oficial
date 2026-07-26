"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { createGoal, updateGoal } from "@/server/goals/actions";
import {
  GOAL_TYPE_LABELS,
  type GoalProgress,
  type GoalType,
} from "@/lib/finance/goals";
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
  targetValue: z.string().trim().min(1, "Informe o valor alvo."),
  initialValue: z.string(),
  startDate: z.string().min(1, "Informe a data inicial."),
  endDate: z.string().min(1, "Informe a data final."),
  note: z.string().trim().max(500),
});

type FormInput = z.infer<typeof formSchema>;
type Option = { id: string; name: string };

// Tipos ligados a uma entidade específica e de onde vem a opção.
const RELATED_BY_TYPE: Partial<
  Record<GoalType, "category" | "investment" | "liability" | "project">
> = {
  income: "category",
  expense_limit: "category",
  contribution: "investment",
  reserve: "investment",
  investment: "investment",
  acquisition: "investment",
  debt_payoff: "liability",
  project: "project",
};

function toInputMoney(value: string | null | undefined): string {
  return value ? value.replace(".", ",") : "";
}

export function GoalDialog({
  categories,
  investments,
  liabilities,
  projects,
  goal,
  open: openProp,
  onOpenChange,
}: {
  categories: Option[];
  investments: Option[];
  liabilities: Option[];
  projects: Option[];
  // Presença de `goal` = modo edição (diálogo controlado pelo pai).
  goal?: GoalProgress;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isEdit = !!goal;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [type, setType] = useState<GoalType>(goal?.type ?? "contribution");
  const [relatedId, setRelatedId] = useState(goal?.relatedEntityId ?? "");
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const today = new Date().toISOString().slice(0, 10);
  const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: goal?.name ?? "",
      targetValue: toInputMoney(goal?.targetValue),
      initialValue: toInputMoney(goal?.initialValue),
      startDate: goal?.startDate ?? today,
      endDate: goal?.endDate ?? nextYear,
      note: goal?.note ?? "",
    },
  });

  const relatedKind = RELATED_BY_TYPE[type];
  const relatedOptions =
    relatedKind === "category"
      ? categories
      : relatedKind === "investment"
        ? investments
        : relatedKind === "liability"
          ? liabilities
          : relatedKind === "project"
            ? projects
            : [];

  function onSubmit(values: FormInput) {
    setServerError(undefined);
    startTransition(async () => {
      const payload = {
        ...values,
        type,
        relatedEntityType: relatedId ? relatedKind : "",
        relatedEntityId: relatedId,
      };
      const result = isEdit
        ? await updateGoal({ ...payload, goalId: goal!.goalId })
        : await createGoal(payload);
      if ("error" in result) {
        setServerError(result.error);
      } else {
        toast.success(isEdit ? "Meta atualizada." : "Meta criada.");
        setOpen(false);
        if (!isEdit) {
          form.reset();
          setType("contribution");
          setRelatedId("");
        }
      }
    });
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isEdit && (
        <DialogTrigger asChild>
          <Button>
            <Plus />
            Nova meta
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar meta" : "Nova meta"}</DialogTitle>
          <DialogDescription>
            Uma meta, vários marcos: o ritmo (esperado, diferença e necessidade
            mensal) é calculado automaticamente pelo prazo.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="goal-name">Nome</Label>
            <Input
              id="goal-name"
              placeholder="Ex.: Aportar 12 mil no ano"
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
                onValueChange={(v) => {
                  setType(v as GoalType);
                  setRelatedId("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(GOAL_TYPE_LABELS) as GoalType[])
                    .filter((t) => t !== "project" || projects.length > 0)
                    .map((value) => (
                      <SelectItem key={value} value={value}>
                        {GOAL_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="goal-target">
                {type === "expense_limit" ? "Limite (R$)" : "Valor alvo (R$)"}
              </Label>
              <Input
                id="goal-target"
                inputMode="decimal"
                placeholder="0,00"
                aria-invalid={!!errors.targetValue}
                {...form.register("targetValue")}
              />
              {errors.targetValue && (
                <p className="text-destructive text-sm">
                  {errors.targetValue.message}
                </p>
              )}
            </div>
          </div>

          {relatedOptions.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>
                {relatedKind === "category"
                  ? "Categoria (opcional — vazio = todas)"
                  : relatedKind === "investment"
                    ? "Investimento (opcional — vazio = todos)"
                    : relatedKind === "project"
                      ? "Projeto (obrigatório)"
                      : "Dívida (opcional — vazio = todas)"}
              </Label>
              <Select value={relatedId} onValueChange={setRelatedId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Todas as entradas do tipo" />
                </SelectTrigger>
                <SelectContent>
                  {relatedOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="goal-start">Início</Label>
              <Input
                id="goal-start"
                type="date"
                {...form.register("startDate")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="goal-end">Fim</Label>
              <Input id="goal-end" type="date" {...form.register("endDate")} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="goal-initial">Valor inicial (R$)</Label>
              <Input
                id="goal-initial"
                inputMode="decimal"
                placeholder="0,00"
                {...form.register("initialValue")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="goal-note">Observação (opcional)</Label>
            <Input id="goal-note" {...form.register("note")} />
          </div>

          {serverError && (
            <p role="alert" className="text-destructive text-sm">
              {serverError}
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "Salvar alterações" : "Criar meta"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
