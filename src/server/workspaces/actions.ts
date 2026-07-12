"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { sanitizeOverrides } from "@/lib/permissions";
import {
  acceptInvitationSchema,
  invitationIdSchema,
  inviteMemberSchema,
  memberIdSchema,
  renameWorkspaceSchema,
  updatePermissionsSchema,
  updateProfileSchema,
} from "@/lib/validation/workspace";
import {
  ACTIVE_WORKSPACE_COOKIE,
  getActiveWorkspace,
} from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";
const INVITE_TTL_DAYS = 7;

type ActionResult<T = undefined> =
  | { error: string }
  | ({ success: true } & (T extends undefined ? object : { data: T }));

// Toda ação revalida sessão + workspace ativo + papel no servidor.
// O RLS do banco é a camada final — estas checagens produzem erros
// amigáveis antes de o banco negar.
async function requireOwnerContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { active } = await getActiveWorkspace();
  if (!active || active.role !== "owner") return null;

  return { supabase, user, workspace: active };
}

export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .maybeSingle();

  if (data) {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  revalidatePath("/", "layout");
}

export async function inviteMember(
  input: unknown
): Promise<ActionResult<{ inviteUrl: string }>> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Dados inválidos. Revise o e-mail e tente novamente." };
  }

  const ctx = await requireOwnerContext();
  if (!ctx) return { error: "Apenas o proprietário pode convidar membros." };

  if (parsed.data.email === ctx.user.email?.toLowerCase()) {
    return { error: "Você já é o proprietário deste espaço." };
  }

  // Token exibido uma única vez; somente o hash é persistido.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await ctx.supabase
    .from("workspace_invitations")
    .insert({
      workspace_id: ctx.workspace.id,
      email: parsed.data.email,
      role: "assistant",
      permissions: sanitizeOverrides(parsed.data.permissions),
      token_hash: tokenHash,
      expires_at: expiresAt,
      invited_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "invitation.created",
    entity_type: "workspace_invitation",
    entity_id: data.id,
    summary: `Convite criado para ${parsed.data.email}`,
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  revalidatePath("/membros");
  return { success: true, data: { inviteUrl: `${appUrl}/convite/${token}` } };
}

export async function revokeInvitation(input: unknown): Promise<ActionResult> {
  const parsed = invitationIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireOwnerContext();
  if (!ctx) return { error: "Apenas o proprietário pode revogar convites." };

  const { data, error } = await ctx.supabase
    .from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("id", parsed.data.invitationId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("status", "pending")
    .select("email")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "invitation.revoked",
    entity_type: "workspace_invitation",
    entity_id: parsed.data.invitationId,
    summary: `Convite revogado (${data.email})`,
  });

  revalidatePath("/membros");
  return { success: true };
}

export async function revokeMember(input: unknown): Promise<ActionResult> {
  const parsed = memberIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireOwnerContext();
  if (!ctx) return { error: "Apenas o proprietário pode revogar acessos." };

  const { data, error } = await ctx.supabase
    .from("workspace_members")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.memberId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("role", "assistant")
    .select("user_id")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "member.revoked",
    entity_type: "workspace_member",
    entity_id: parsed.data.memberId,
    summary: "Acesso de assistente revogado",
  });

  revalidatePath("/membros");
  return { success: true };
}

export async function reactivateMember(input: unknown): Promise<ActionResult> {
  const parsed = memberIdSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireOwnerContext();
  if (!ctx) return { error: "Apenas o proprietário pode reativar acessos." };

  const { data, error } = await ctx.supabase
    .from("workspace_members")
    .update({ status: "active", revoked_at: null })
    .eq("id", parsed.data.memberId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("role", "assistant")
    .select("user_id")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "member.reactivated",
    entity_type: "workspace_member",
    entity_id: parsed.data.memberId,
    summary: "Acesso de assistente reativado",
  });

  revalidatePath("/membros");
  return { success: true };
}

export async function updateMemberPermissions(
  input: unknown
): Promise<ActionResult> {
  const parsed = updatePermissionsSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ctx = await requireOwnerContext();
  if (!ctx) {
    return { error: "Apenas o proprietário pode alterar permissões." };
  }

  const { data, error } = await ctx.supabase
    .from("workspace_members")
    .update({ permissions: sanitizeOverrides(parsed.data.permissions) })
    .eq("id", parsed.data.memberId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("role", "assistant")
    .select("user_id")
    .maybeSingle();

  if (error || !data) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "member.permissions_updated",
    entity_type: "workspace_member",
    entity_id: parsed.data.memberId,
    summary: "Permissões de assistente atualizadas",
    metadata: { permissions: sanitizeOverrides(parsed.data.permissions) },
  });

  revalidatePath("/membros");
  return { success: true };
}

const ACCEPT_ERRORS: Record<string, string> = {
  invitation_not_found: "Convite não encontrado. Confira o link recebido.",
  invitation_revoked: "Este convite foi revogado pelo proprietário.",
  invitation_already_accepted: "Este convite já foi utilizado.",
  invitation_expired: "Este convite expirou. Peça um novo ao proprietário.",
  invitation_email_mismatch:
    "Este convite foi enviado para outro e-mail. Entre com a conta correta.",
  not_authenticated: "Entre na sua conta para aceitar o convite.",
};

export async function acceptInvitation(input: unknown): Promise<ActionResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) return { error: ACCEPT_ERRORS.invitation_not_found };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", {
    invitation_token: parsed.data.token,
  });

  if (error) {
    const key = Object.keys(ACCEPT_ERRORS).find((k) =>
      error.message.includes(k)
    );
    return { error: key ? ACCEPT_ERRORS[key] : GENERIC_ERROR };
  }

  if (typeof data === "string") {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, data, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function renameWorkspace(input: unknown): Promise<ActionResult> {
  const parsed = renameWorkspaceSchema.safeParse(input);
  if (!parsed.success) return { error: "Informe um nome válido." };

  const ctx = await requireOwnerContext();
  if (!ctx) {
    return { error: "Apenas o proprietário pode renomear o espaço." };
  }

  const { error } = await ctx.supabase
    .from("workspaces")
    .update({ name: parsed.data.name })
    .eq("id", ctx.workspace.id);

  if (error) return { error: GENERIC_ERROR };

  await ctx.supabase.from("audit_logs").insert({
    workspace_id: ctx.workspace.id,
    user_id: ctx.user.id,
    action: "workspace.renamed",
    entity_type: "workspace",
    entity_id: ctx.workspace.id,
    summary: `Espaço renomeado para "${parsed.data.name}"`,
  });

  revalidatePath("/", "layout");
  return { success: true };
}

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) return { error: "Informe um nome válido." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: GENERIC_ERROR };

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", user.id);

  if (error) return { error: GENERIC_ERROR };

  revalidatePath("/", "layout");
  return { success: true };
}
