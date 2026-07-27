"use client";

import { useMemo, useState, useTransition } from "react";
import { Archive, Loader2, Pencil, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { archiveGoal, updateGoalProgressValue } from "@/server/goals/actions";
import {
  GOAL_HORIZON_LABELS,
  GOAL_STATUS_LABELS,
  GOAL_STATUS_VARIANTS,
  GOAL_TYPE_LABELS,
  goalHorizon,
  type GoalProgress,
  type GoalStatus,
  type GoalType,
} from "@/lib/finance/goals";
import { formatBRL, parseMoneyInput } from "@/lib/finance/money";
import { formatDateBR } from "@/lib/finance/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { GoalDialog } from "./goal-dialog";

type Option = { id: string; name: string };

type HorizonFilter = "all" | "annual" | "5y" | "10y" | "15y";
type StatusFilter = "all" | "behind" | "on_track" | "completed";

const HORIZON_OPTIONS: { key: HorizonFilter; label: string }[] = [
  { key: "all", label: "Todos os prazos" },
  { key: "annual", label: "Anual" },
  { key: "5y", label: "5 anos" },
  { key: "10y", label: "10 anos" },
  { key: "15y", label: "15 anos" },
];

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Todas as situações" },
  { key: "behind", label: "Atrasadas" },
  { key: "on_track", label: "No ritmo" },
  { key: "completed", label: "Concluídas" },
];

function matchesHorizon(goal: GoalProgress, filter: HorizonFilter): boolean {
  return filter === "all" || goalHorizon(goal.monthsTotal) === filter;
}

function matchesStatus(goal: GoalProgress, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "behind":
      return goal.status === "behind" || goal.status === "expired";
    case "on_track":
      return goal.status === "on_track" || goal.status === "ahead";
    case "completed":
      return goal.status === "completed";
  }
}

export function PlanningBoard({
  goals,
  canManage,
  categories,
  investments,
  liabilities,
  projects,
}: {
  goals: GoalProgress[];
  canManage: boolean;
  categories: Option[];
  investments: Option[];
  liabilities: Option[];
  projects: Option[];
}) {
  const [horizon, setHorizon] = useState<HorizonFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<GoalType | "all">("all");
  const [overrideGoal, setOverrideGoal] = useState<GoalProgress | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  const [editGoal, setEditGoal] = useState<GoalProgress | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(
    () =>
      goals.filter(
        (g) =>
          matchesHorizon(g, horizon) &&
          matchesStatus(g, statusFilter) &&
          (typeFilter === "all" || g.type === typeFilter)
      ),
    [goals, horizon, statusFilter, typeFilter]
  );

  function archive(goal: GoalProgress) {
    startTransition(async () => {
      const result = await archiveGoal({ goalId: goal.goalId });
      if ("error" in result) toast.error(result.error);
      else toast.success(`Meta "${goal.name}" arquivada.`);
    });
  }

  function saveOverride() {
    if (!overrideGoal) return;
    const parsed = parseMoneyInput(overrideValue);
    if (!parsed) {
      toast.error("Informe um valor válido.");
      return;
    }
    startTransition(async () => {
      const result = await updateGoalProgressValue({
        goalId: overrideGoal.goalId,
        currentValueOverride: parsed,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Progresso atualizado.");
        setOverrideGoal(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filtros de metas"
      >
        <Select
          value={horizon}
          onValueChange={(v) => setHorizon(v as HorizonFilter)}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-44"
            aria-label="Filtrar por prazo"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HORIZON_OPTIONS.map(({ key, label }) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-48"
            aria-label="Filtrar por situação"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(({ key, label }) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as GoalType | "all")}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-48"
            aria-label="Filtrar por tipo"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {(Object.keys(GOAL_TYPE_LABELS) as GoalType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {GOAL_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhuma meta neste filtro.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((goal) => (
            <GoalRow
              key={goal.goalId}
              goal={goal}
              canManage={canManage}
              isPending={isPending}
              onEdit={() => setEditGoal(goal)}
              onArchive={() => archive(goal)}
              onEditOverride={() => {
                setOverrideValue(goal.currentValue.replace(".", ","));
                setOverrideGoal(goal);
              }}
            />
          ))}
        </div>
      )}

      <Dialog
        open={!!overrideGoal}
        onOpenChange={(open) => !open && setOverrideGoal(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Atualizar progresso de “{overrideGoal?.name}”
            </DialogTitle>
            <DialogDescription>
              Só metas personalizadas usam valor manual — as demais são
              calculadas automaticamente das transações e agregados.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="override-value">Valor atual (R$)</Label>
            <Input
              id="override-value"
              inputMode="decimal"
              value={overrideValue}
              onChange={(event) => setOverrideValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOverrideGoal(null)}>
              Cancelar
            </Button>
            <Button onClick={saveOverride} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editGoal && (
        <GoalDialog
          key={editGoal.goalId}
          categories={categories}
          investments={investments}
          liabilities={liabilities}
          projects={projects}
          goal={editGoal}
          open={!!editGoal}
          onOpenChange={(open) => !open && setEditGoal(null)}
        />
      )}
    </div>
  );
}

function GoalRow({
  goal,
  canManage,
  isPending,
  onEdit,
  onArchive,
  onEditOverride,
}: {
  goal: GoalProgress;
  canManage: boolean;
  isPending: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onEditOverride: () => void;
}) {
  const pct = goal.progressPercent ? Number(goal.progressPercent) : null;
  const diff = Number(goal.paceDiff);
  const status = goal.status as GoalStatus;
  const minimize = goal.direction === "minimize";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 truncate font-medium">{goal.name}</span>
          <Badge variant="outline">{GOAL_TYPE_LABELS[goal.type]}</Badge>
          <Badge variant="outline">
            {GOAL_HORIZON_LABELS[goalHorizon(goal.monthsTotal)]}
          </Badge>
          <Badge variant={GOAL_STATUS_VARIANTS[status]}>
            {GOAL_STATUS_LABELS[status]}
          </Badge>
        </div>

        {pct !== null && (
          <div
            role="progressbar"
            aria-valuenow={Math.min(100, Math.round(pct))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progresso de ${goal.name}`}
            className="bg-muted h-2 w-full overflow-hidden rounded-full"
          >
            <div
              className={`h-full rounded-full ${
                minimize && pct > 100 ? "bg-destructive" : "bg-primary"
              }`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        )}

        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
          <span>
            {minimize ? "Usado" : "Atual"}:{" "}
            <strong className="text-foreground">
              {formatBRL(goal.currentValue)}
            </strong>
            {pct !== null && ` (${pct.toLocaleString("pt-BR")}%)`}
          </span>
          <span>
            {minimize ? "Limite" : "Alvo"}: {formatBRL(goal.targetValue)}
          </span>
          <span>Esperado hoje: {formatBRL(goal.expectedValue)}</span>
          <span className={diff < 0 ? "text-destructive" : "text-primary"}>
            Ritmo: {diff >= 0 ? "+" : "−"}
            {formatBRL(Math.abs(diff).toFixed(2))}
          </span>
          <span>
            {minimize ? "Margem mensal" : "Necessário/mês"}:{" "}
            {formatBRL(goal.monthlyNeedUpdated)}
          </span>
          <span>
            Prazo: {formatDateBR(goal.endDate)} ({goal.monthsRemaining}{" "}
            {goal.monthsRemaining === 1 ? "mês restante" : "meses restantes"})
          </span>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              disabled={isPending}
            >
              <Pencil />
              Editar
            </Button>
            {goal.type === "custom" && (
              <Button
                size="sm"
                variant="outline"
                onClick={onEditOverride}
                disabled={isPending}
              >
                <TrendingUp />
                Atualizar progresso
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onArchive}
              disabled={isPending}
            >
              <Archive />
              Arquivar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
