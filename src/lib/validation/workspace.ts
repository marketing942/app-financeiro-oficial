import { z } from "zod";

import { PERMISSION_KEYS } from "@/lib/permissions";
import { emailSchema } from "@/lib/validation/auth";

const permissionOverridesSchema = z
  .object(
    Object.fromEntries(
      PERMISSION_KEYS.map((key) => [key, z.boolean().optional()])
    )
  )
  .strict();

export const inviteMemberSchema = z.object({
  email: emailSchema.transform((value) => value.toLowerCase()),
  permissions: permissionOverridesSchema.default({}),
});

export const updatePermissionsSchema = z.object({
  memberId: z.string().uuid(),
  permissions: permissionOverridesSchema,
});

export const memberIdSchema = z.object({
  memberId: z.string().uuid(),
});

export const invitationIdSchema = z.object({
  invitationId: z.string().uuid(),
});

export const renameWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do espaço.")
    .max(80, "Nome muito longo."),
});

export const updateProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Informe seu nome completo.")
    .max(120, "Nome muito longo."),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdatePermissionsInput = z.infer<typeof updatePermissionsSchema>;
export type RenameWorkspaceInput = z.infer<typeof renameWorkspaceSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
