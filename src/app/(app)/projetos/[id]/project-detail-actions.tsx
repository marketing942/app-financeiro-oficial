"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Circle, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  addProjectTransaction,
  addStage,
  deleteProject,
  setStageStatus,
  updateProjectStatus,
} from "@/server/projects/actions";
import {
  PROJECT_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  type ProjectCostCategory,
  type ProjectStage,
  type ProjectStatus,
  type StageStatus,
} from "@/lib/finance/projects";
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

export function ProjectStatusSelect({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatus;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={status}
      disabled={isPending}
      onValueChange={(value) =>
        startTransition(async () => {
          const result = await updateProjectStatus({
            projectId,
            status: value,
          });
          if ("error" in result) toast.error(result.error);
          else toast.success("Status atualizado.");
        })
      }
    >
      <SelectTrigger size="sm" aria-label="Status do projeto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((s) => (
          <SelectItem key={s} value={s}>
            {PROJECT_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Trash2 />
          Excluir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir “{projectName}”?</DialogTitle>
          <DialogDescription>
            Exclusão lógica: o projeto sai das listas, mas lançamentos e
            histórico são preservados para auditoria.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteProject({ projectId });
                if ("error" in result) toast.error(result.error);
                else {
                  toast.success("Projeto excluído.");
                  router.push("/projetos");
                }
              })
            }
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Excluir projeto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STAGE_CYCLE: Record<StageStatus, StageStatus> = {
  pending: "in_progress",
  in_progress: "done",
  done: "pending",
  skipped: "pending",
};

export function StageList({
  projectId,
  stages,
  canManage,
}: {
  projectId: string;
  stages: ProjectStage[];
  canManage: boolean;
}) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  function create() {
    if (!name.trim()) {
      toast.error("Informe o nome da etapa.");
      return;
    }
    startTransition(async () => {
      const result = await addStage({ projectId, name });
      if ("error" in result) toast.error(result.error);
      else setName("");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {stages.length === 0 && (
        <p className="text-muted-foreground text-sm">Nenhuma etapa ainda.</p>
      )}
      <ul className="flex flex-col gap-1">
        {stages.map((stage) => (
          <li key={stage.id} className="flex items-center gap-2 text-sm">
            {canManage ? (
              <button
                type="button"
                disabled={isPending}
                aria-label={`Etapa ${stage.name}: ${STAGE_STATUS_LABELS[stage.status]} — alternar`}
                className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
                onClick={() =>
                  startTransition(async () => {
                    const result = await setStageStatus({
                      stageId: stage.id,
                      status: STAGE_CYCLE[stage.status],
                    });
                    if ("error" in result) toast.error(result.error);
                  })
                }
              >
                {stage.status === "done" ? (
                  <CheckCircle2 className="text-primary size-5" />
                ) : (
                  <Circle
                    className={
                      stage.status === "in_progress"
                        ? "text-primary size-5"
                        : "text-muted-foreground size-5"
                    }
                  />
                )}
              </button>
            ) : stage.status === "done" ? (
              <CheckCircle2 className="text-primary size-5" aria-hidden />
            ) : (
              <Circle className="text-muted-foreground size-5" aria-hidden />
            )}
            <span
              className={stage.status === "done" ? "text-muted-foreground" : ""}
            >
              {stage.name}
            </span>
            <span className="text-muted-foreground ml-auto text-xs">
              {STAGE_STATUS_LABELS[stage.status]}
            </span>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="stage-name" className="sr-only">
              Nova etapa
            </Label>
            <Input
              id="stage-name"
              placeholder="Nova etapa…"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={create}
            disabled={isPending}
          >
            <Plus />
            Adicionar
          </Button>
        </div>
      )}
    </div>
  );
}

const KIND_LABELS = {
  cost: "Custo",
  income: "Receita",
  contribution: "Aporte",
} as const;

export function ProjectTransactionDialog({
  projectId,
  costCategories,
  accounts,
}: {
  projectId: string;
  costCategories: ProjectCostCategory[];
  accounts: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"cost" | "income" | "contribution">("cost");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [costCategoryId, setCostCategoryId] = useState("");
  const [realizedNow, setRealizedNow] = useState(true);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const parsed = parseMoneyInput(amount);
    if (!parsed) {
      toast.error("Informe um valor válido.");
      return;
    }
    if (!description.trim()) {
      toast.error("Descreva o lançamento.");
      return;
    }
    startTransition(async () => {
      const result = await addProjectTransaction({
        projectId,
        kind,
        description,
        amount: parsed,
        date,
        accountId,
        costCategoryId,
        realizedNow,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Lançamento registrado no projeto.");
        setOpen(false);
        setDescription("");
        setAmount("");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Novo lançamento
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lançamento do projeto</DialogTitle>
          <DialogDescription>
            Custos e receitas pertencem ao projeto; aportes saem do caixa sem
            contar como despesa pessoal.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>Tipo</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as typeof kind)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map(
                  (k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ptx-amount">Valor (R$)</Label>
            <Input
              id="ptx-amount"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ptx-desc">Descrição</Label>
          <Input
            id="ptx-desc"
            placeholder="Ex.: Cimento e areia, sinal da venda…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {kind === "cost" && costCategories.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>Categoria de custo</Label>
            <Select value={costCategoryId} onValueChange={setCostCategoryId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escolher categoria" />
              </SelectTrigger>
              <SelectContent>
                {costCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ptx-date">Data</Label>
            <Input
              id="ptx-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Conta (opcional)</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sem conta" />
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
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={realizedNow}
            onCheckedChange={(checked) => setRealizedNow(checked === true)}
          />
          Já realizado
        </label>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
