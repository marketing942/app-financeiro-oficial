// Catálogo de permissões granulares concedíveis a assistentes.
// Espelha o conteúdo de `role_permissions` (migration 0002): o owner sempre
// tem tudo; assistentes partem de "false" e recebem overrides individuais
// em `workspace_members.permissions`.

export const PERMISSION_KEYS = [
  "delete_transactions",
  "edit_categories",
  "edit_goals",
  "edit_assets",
  "edit_investments",
  "edit_liabilities",
  "edit_projects",
  "export_reports",
  "view_full_payment_data",
  "use_nylo_advanced",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type PermissionOverrides = Partial<Record<PermissionKey, boolean>>;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  delete_transactions: "Excluir lançamentos",
  edit_categories: "Editar categorias",
  edit_goals: "Editar metas",
  edit_assets: "Editar patrimônio",
  edit_investments: "Editar investimentos",
  edit_liabilities: "Editar dívidas",
  edit_projects: "Editar projetos",
  export_reports: "Exportar relatórios",
  view_full_payment_data: "Ver dados de pagamento completos",
  use_nylo_advanced: "Funções avançadas da Nylo",
};

export type MemberRole = "owner" | "assistant";

// Mesma regra da função SQL app.has_permission: owner sempre passa;
// assistente usa o override individual, senão o default do papel (false).
export function resolvePermission(
  role: MemberRole,
  overrides: PermissionOverrides,
  key: PermissionKey
): boolean {
  if (role === "owner") return true;
  return overrides[key] ?? false;
}

export function sanitizeOverrides(input: unknown): PermissionOverrides {
  if (typeof input !== "object" || input === null) return {};
  const result: PermissionOverrides = {};
  for (const key of PERMISSION_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}
