import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import type { MemberRole, PermissionOverrides } from "@/lib/permissions";
import { sanitizeOverrides } from "@/lib/permissions";

export const ACTIVE_WORKSPACE_COOKIE = "active-workspace";

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: MemberRole;
  permissions: PermissionOverrides;
};

export type WorkspaceMember = {
  id: string;
  userId: string;
  role: MemberRole;
  status: "active" | "revoked";
  permissions: PermissionOverrides;
  lastAccessAt: string | null;
  createdAt: string;
  fullName: string;
};

export type PendingInvitation = {
  id: string;
  email: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
};

export async function getUserWorkspaces(): Promise<WorkspaceSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, permissions, status, workspace:workspaces(id, name)")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.flatMap((row) => {
    const workspace = row.workspace as unknown as {
      id: string;
      name: string;
    } | null;
    if (!workspace) return [];
    return [
      {
        id: workspace.id,
        name: workspace.name,
        role: row.role as MemberRole,
        permissions: sanitizeOverrides(row.permissions),
      },
    ];
  });
}

// Espaço ativo: cookie validado contra as memberships reais; sem cookie
// (ou cookie inválido), usa o primeiro espaço do usuário.
export async function getActiveWorkspace(): Promise<{
  active: WorkspaceSummary | null;
  all: WorkspaceSummary[];
}> {
  const all = await getUserWorkspaces();
  if (all.length === 0) return { active: null, all };

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const active = all.find((w) => w.id === preferred) ?? all[0];

  // Atualiza "último acesso" (função com throttle no banco).
  const supabase = await createClient();
  await supabase.rpc("touch_workspace_access", { ws: active.id });

  return { active, all };
}

export async function getWorkspaceMembers(
  workspaceId: string
): Promise<WorkspaceMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      "id, user_id, role, status, permissions, last_access_at, created_at, profile:profiles(full_name)"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    userId: row.user_id,
    role: row.role as MemberRole,
    status: row.status as "active" | "revoked",
    permissions: sanitizeOverrides(row.permissions),
    lastAccessAt: row.last_access_at,
    createdAt: row.created_at,
    fullName:
      (row.profile as unknown as { full_name: string } | null)?.full_name ??
      "—",
  }));
}

export async function getPendingInvitations(
  workspaceId: string
): Promise<PendingInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_invitations")
    .select("id, email, status, expires_at, created_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status as PendingInvitation["status"],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export type InvitationPreview = {
  workspaceName: string;
  inviterName: string;
  invitedEmail: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
};

export async function getInvitationPreview(
  token: string
): Promise<InvitationPreview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invitation_preview", {
    invitation_token: token,
  });

  if (error || !data || data.length === 0) return null;

  const row = data[0] as {
    workspace_name: string;
    inviter_name: string;
    invited_email: string;
    status: InvitationPreview["status"];
    expires_at: string;
  };

  return {
    workspaceName: row.workspace_name,
    inviterName: row.inviter_name,
    invitedEmail: row.invited_email,
    status: row.status,
    expiresAt: row.expires_at,
  };
}
