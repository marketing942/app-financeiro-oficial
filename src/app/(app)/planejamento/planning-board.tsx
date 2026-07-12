"use client";

import { useMemo, useState, useTransition } from "react";
import { Archive, Loader2, Pencil } from "lucide-react";
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

type QuickFilter =
  "all" | "annual" | "5y" | "10y" | "15y" | "behind" | "on_track" | "completed";

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "annual", label: "Anual" },
  { key: "5y", label: "5 anos" },
  { key: "10y", label: "10 anos" },
  { key: "15y", label: "15 anos" },
  { key: "behind", label: "Atrasadas" },
  { key: "on_track", label: "No ritmo" },
  { key: "completed", label: "Concluídas" },
];

function matchesFilter(goal: GoalProgress, filter: QuickFilter): boolean {
  const horizon = goalHorizon(goal.monthsTotal);
  switch (filter) {
    case "all":
      return true;
    case "annual":
    case "5y":
    case "10y":
    case "15y":
      return horizon === filter;
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
}: {
  goals: GoalProgress[];
  canManage: boolean;
}) {
  const [filter, setFilter] = useState<QuickFilter>("all");
  const [typeFilter, setTypeFilter] = useState<GoalType | "all">("all");
  const [overrideGoal, setOverrideGoal] = useState<GoalProgress | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(
    () =>
      goals.filter(
        (g) =>
          matchesFilter(g, filter) &&
          (typeFilter === "all" || g.type === typeFilter)
      ),
    [goals, filter, typeFilter]
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
        {QUICK_FILTERS.map(({ key, label }) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as GoalType | "all")}
        >
          <SelectTrigger
            size="sm"
            className="w-44"
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
    </div>
  );
}

function GoalRow({
  goal,
  canManage,
  isPending,
  onArchive,
  onEditOverride,
}: {
  goal: GoalProgress;
  canManage: boolean;
  isPending: boolean;
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
            {goal.type === "custom" && (
              <Button
                size="sm"
                variant="outline"
                onClick={onEditOverride}
                disabled={isPending}
              >
                <Pencil />
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
