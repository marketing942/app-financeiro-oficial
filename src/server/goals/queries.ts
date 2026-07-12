import { createClient } from "@/lib/supabase/server";
import type {
  GoalDirection,
  GoalProgress,
  GoalStatus,
  GoalType,
} from "@/lib/finance/goals";

export type { GoalProgress };

export async function listGoalProgress(
  workspaceId: string
): Promise<GoalProgress[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("goal_progress", {
    p_workspace: workspaceId,
  });
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) => ({
    goalId: String(row.goal_id),
    name: String(row.name),
    type: row.type as GoalType,
    direction: row.direction as GoalDirection,
    relatedEntityType: (row.related_entity_type as string | null) ?? null,
    relatedEntityId: (row.related_entity_id as string | null) ?? null,
    initialValue: String(row.initial_value),
    targetValue: String(row.target_value),
    currentValue: String(row.current_value),
    expectedValue: String(row.expected_value),
    paceDiff: String(row.pace_diff),
    monthlyNeedInitial: String(row.monthly_need_initial),
    monthlyNeedUpdated: String(row.monthly_need_updated),
    progressPercent:
      row.progress_percent === null ? null : String(row.progress_percent),
    monthsTotal: Number(row.months_total),
    monthsElapsed: Number(row.months_elapsed),
    monthsRemaining: Number(row.months_remaining),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    priority: Number(row.priority),
    note: (row.note as string | null) ?? null,
    status: row.status as GoalStatus,
  }));
}
