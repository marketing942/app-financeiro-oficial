"use client";

import { useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { revokeInvitation } from "@/server/workspaces/actions";
import type { PendingInvitation } from "@/server/workspaces/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function InvitationRow({
  invitation,
}: {
  invitation: PendingInvitation;
}) {
  const [isPending, startTransition] = useTransition();

  const expired = new Date(invitation.expiresAt) < new Date();

  function revoke() {
    startTransition(async () => {
      const result = await revokeInvitation({ invitationId: invitation.id });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Convite revogado.");
      }
    });
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{invitation.email}</span>
        <span className="text-muted-foreground text-xs">
          Expira em{" "}
          {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
            new Date(invitation.expiresAt)
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {expired ? (
          <Badge variant="warning">Expirado</Badge>
        ) : (
          <Badge variant="secondary">Pendente</Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={revoke}
          disabled={isPending}
          aria-label={`Revogar convite de ${invitation.email}`}
        >
          {isPending ? <Loader2 className="animate-spin" /> : <X />}
        </Button>
      </div>
    </li>
  );
}
