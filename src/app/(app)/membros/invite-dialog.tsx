"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { inviteMember } from "@/server/workspaces/actions";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  type PermissionKey,
  type PermissionOverrides,
} from "@/lib/permissions";
import { inviteMemberSchema } from "@/lib/validation/workspace";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormInput = z.input<typeof inviteMemberSchema>;

export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [permissions, setPermissions] = useState<PermissionOverrides>({});
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "", permissions: {} },
  });

  function onSubmit(values: FormInput) {
    setServerError(undefined);
    startTransition(async () => {
      const result = await inviteMember({ ...values, permissions });
      if ("error" in result) {
        setServerError(result.error);
      } else {
        setInviteUrl(result.data.inviteUrl);
      }
    });
  }

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Link copiado. Envie ao assistente.");
    setTimeout(() => setCopied(false), 2000);
  }

  function reset(openState: boolean) {
    setOpen(openState);
    if (!openState) {
      setInviteUrl(undefined);
      setServerError(undefined);
      setPermissions({});
      form.reset();
    }
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus />
          Convidar assistente
        </Button>
      </DialogTrigger>
      <DialogContent>
        {inviteUrl ? (
          <>
            <DialogHeader>
              <DialogTitle>Convite criado</DialogTitle>
              <DialogDescription>
                Envie o link abaixo ao assistente. Por segurança, ele é exibido
                apenas uma vez e expira em 7 dias.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={inviteUrl}
                aria-label="Link do convite"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={copyLink}
                aria-label="Copiar link do convite"
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <Button variant="secondary" onClick={() => reset(false)}>
              Concluir
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Convidar assistente</DialogTitle>
              <DialogDescription>
                O assistente cria a própria conta e senha — senhas nunca são
                compartilhadas. Você pode revogar o acesso a qualquer momento.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
              noValidate
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-email">E-mail do assistente</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="assistente@exemplo.com"
                  aria-invalid={!!errors.email}
                  {...form.register("email")}
                />
                {errors.email && (
                  <p className="text-destructive text-sm">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">
                  Permissões adicionais (opcional)
                </legend>
                <p className="text-muted-foreground text-xs">
                  Por padrão o assistente registra lançamentos e consulta o
                  espaço. Marque abaixo o que mais ele pode fazer.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PERMISSION_KEYS.map((key: PermissionKey) => (
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
              </fieldset>

              {serverError && (
                <p role="alert" className="text-destructive text-sm">
                  {serverError}
                </p>
              )}

              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Gerar link de convite
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
