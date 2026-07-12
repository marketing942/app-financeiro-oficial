import { createClient } from "@/lib/supabase/server";
import type {
  BusinessProject,
  ProjectCostCategory,
  ProjectCostKind,
  ProjectFinancials,
  ProjectStage,
  ProjectStatus,
  ProjectTransaction,
  ProjectType,
  StageStatus,
} from "@/lib/finance/projects";

export type {
  BusinessProject,
  ProjectFinancials,
  ProjectStage,
  ProjectCostCategory,
  ProjectTransaction,
};

function mapProject(row: Record<string, unknown>): BusinessProject {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type as ProjectType,
    description: (row.description as string | null) ?? null,
    startDate: (row.start_date as string | null) ?? null,
    expectedEndDate: (row.expected_end_date as string | null) ?? null,
    endDate: (row.end_date as string | null) ?? null,
    budget: row.budget === null ? null : String(row.budget),
    initialCapital:
      row.initial_capital === null ? null : String(row.initial_capital),
    expectedSaleValue:
      row.expected_sale_value === null ? null : String(row.expected_sale_value),
    status: row.status as ProjectStatus,
    note: (row.note as string | null) ?? null,
  };
}

export async function listProjects(
  workspaceId: string
): Promise<BusinessProject[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_projects")
    .select(
      "id, name, type, description, start_date, expected_end_date, end_date, budget, initial_capital, expected_sale_value, status, note"
    )
    .eq("workspace_id", workspaceId)
    .order("status")
    .order("name");
  return (data ?? []).map(mapProject);
}

export async function getProject(
  workspaceId: string,
  projectId: string
): Promise<BusinessProject | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_projects")
    .select(
      "id, name, type, description, start_date, expected_end_date, end_date, budget, initial_capital, expected_sale_value, status, note"
    )
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .maybeSingle();
  return data ? mapProject(data) : null;
}

export async function getProjectFinancials(
  workspaceId: string
): Promise<Map<string, ProjectFinancials>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("project_financials", {
    p_workspace: workspaceId,
  });
  const map = new Map<string, ProjectFinancials>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    map.set(String(row.project_id), {
      projectId: String(row.project_id),
      plannedCost: String(row.planned_cost),
      actualCost: String(row.actual_cost),
      directCostActual: String(row.direct_cost_actual),
      deductionCostActual: String(row.deduction_cost_actual),
      capitalInvested: String(row.capital_invested),
      revenueActual: String(row.revenue_actual),
      grossResult: String(row.gross_result),
      netResult: String(row.net_result),
      netMargin: row.net_margin === null ? null : String(row.net_margin),
      returnOnCapital:
        row.return_on_capital === null ? null : String(row.return_on_capital),
    });
  }
  return map;
}

export async function listStages(
  workspaceId: string,
  projectId: string
): Promise<ProjectStage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_stages")
    .select("id, name, sort_order, start_date, end_date, status")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .order("sort_order");
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as StageStatus,
  }));
}

export async function listCostCategories(
  workspaceId: string,
  projectId: string
): Promise<ProjectCostCategory[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_cost_categories")
    .select("id, name, kind, sort_order")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .order("sort_order");
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as ProjectCostKind,
    sortOrder: row.sort_order,
  }));
}

export async function listProjectTransactions(
  workspaceId: string,
  projectId: string
): Promise<ProjectTransaction[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_transactions")
    .select(
      "id, nature, description, project_cost_category_id, planned_amount, actual_amount, competence_month, realized_date, status"
    )
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .order("competence_month", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((row) => ({
    id: row.id,
    nature: row.nature as ProjectTransaction["nature"],
    description: row.description,
    costCategoryId: row.project_cost_category_id,
    plannedAmount:
      row.planned_amount === null ? null : String(row.planned_amount),
    actualAmount: row.actual_amount === null ? null : String(row.actual_amount),
    competenceMonth: row.competence_month,
    realizedDate: row.realized_date,
    status: row.status,
  }));
}
