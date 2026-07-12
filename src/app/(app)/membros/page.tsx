import type { Metadata } from "next";
import { Users } from "lucide-react";

import {
  getActiveWorkspace,
  getPendingInvitations,
  getWorkspaceMembers,
} from "@/server/workspaces/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InviteDialog } from "./invite-dialog";
import { MemberCard } from "./member-card";
import { InvitationRow } from "./invitation-row";

export const metadata: Metadata = { title: "Membros e acessos" };

export default async function MembrosPage() {
  const { active } = await getActiveWorkspace();

  if (!active) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nenhum espaço encontrado</CardTitle>
          <CardDescription>
            Sua conta ainda não participa de nenhum espaço financeiro.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isOwner = active.role === "owner";
  const [members, invitations] = await Promise.all([
    getWorkspaceMembers(active.id),
    isOwner ? getPendingInvitations(active.id) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Membros e acessos
          </h1>
          <p className="text-muted-foreground text-sm">
            Quem pode ver e registrar dados em “{active.name}”.
          </p>
        </div>
        {isOwner && <InviteDialog />}
      </div>

      <section aria-label="Membros" className="flex flex-col gap-3">
        {members.map((member) => (
          <MemberCard key={member.id} member={member} isOwnerView={isOwner} />
        ))}
      </section>

      {isOwner && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4" />
              Convites pendentes
            </CardTitle>
            <CardDescription>
              Convites ainda não aceitos. Revogar um convite invalida o link
              imediatamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {invitations.map((invitation) => (
                <InvitationRow key={invitation.id} invitation={invitation} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!isOwner && (
        <p className="text-muted-foreground text-sm">
          Somente o proprietário do espaço pode convidar, revogar e alterar
          permissões.
        </p>
      )}
    </div>
  );
}
