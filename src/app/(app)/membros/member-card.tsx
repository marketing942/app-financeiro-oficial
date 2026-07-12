"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck, UserX, Undo2 } from "lucide-react";
import { toast } from "sonner";

import {
  reactivateMember,
  revokeMember,
  updateMemberPermissions,
} from "@/server/workspaces/actions";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  type PermissionOverrides,
} from "@/lib/permissions";
import type { WorkspaceMember } from "@/server/workspaces/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function MemberCard({
  member,
  isOwnerView,
}: {
  member: WorkspaceMember;
  isOwnerView: boolean;
}) {
  const [permissions, setPermissions] = useState<PermissionOverrides>(
    member.permissions
  );
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isAssistant = member.role === "assistant";
  const isRevoked = member.status === "revoked";

  function savePermissions() {
    startTransition(async () => {
      const result = await updateMemberPermissions({
        memberId: member.id,
        permissions,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Permissões atualizadas.");
        setPermissionsOpen(false);
      }
    });
  }

  function confirmRevoke() {
    startTransition(async () => {
      const result = await revokeMember({ memberId: member.id });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Acesso revogado imediatamente.");
        setRevokeOpen(false);
      }
    });
  }

  function reactivate() {
    startTransition(async () => {
      const result = await reactivateMember({ memberId: member.id });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Acesso reativado.");
      }
    });
  }

  return (
    <Card className={isRevoked ? "opacity-70" : undefined}>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{member.fullName}</span>
            <Badge variant={member.role === "owner" ? "default" : "secondary"}>
              {member.role === "owner" ? "Proprietário" : "Assistente"}
            </Badge>
            {isRevoked && <Badge variant="destructive">Revogado</Badge>}
          </div>
          <span className="text-muted-foreground text-xs">
            Último acesso: {formatDate(member.lastAccessAt)}
          </span>
        </div>

        {isOwnerView && isAssistant && (
          <div className="flex flex-wrap gap-2">
            {!isRevoked && (
              <Dialog open={permissionsOpen} onOpenChange={setPermissionsOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ShieldCheck />
                    Permissões
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Permissões de {member.fullName}</DialogTitle>
                    <DialogDescription>
                      Além do padrão de assistente (registrar e consultar
                      lançamentos), este membro também pode:
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {PERMISSION_KEYS.map((key) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={permissions[key] ?? false}
                          onCheckedChange={(checked) =>
                            setPermissions((prev) => ({
                              ...prev,
                              [key]: checked === true,
                            }))
                          }
                        />
                        {PERMISSION_LABELS[key]}
                      </label>
                    ))}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="secondary"
                      onClick={() => setPermissionsOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button onClick={savePermissions} disabled={isPending}>
                      {isPending && <Loader2 className="size-4 animate-spin" />}
                      Salvar permissões
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {isRevoked ? (
              <Button
                variant="outline"
                size="sm"
                onClick={reactivate}
                disabled={isPending}
              >
                <Undo2 />
                Reativar
              </Button>
            ) : (
              <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <UserX />
                    Revogar
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Revogar acesso?</DialogTitle>
                    <DialogDescription>
                      {member.fullName} perde o acesso a este espaço
                      imediatamente — leitura e escrita são bloqueadas na hora.
                      Você pode reativar depois, se quiser.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="secondary"
                      onClick={() => setRevokeOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={confirmRevoke}
                      disabled={isPending}
                    >
                      {isPending && <Loader2 className="size-4 animate-spin" />}
                      Revogar acesso
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
