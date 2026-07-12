"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateProfile } from "@/server/workspaces/actions";
import {
  updateProfileSchema,
  type UpdateProfileInput,
} from "@/lib/validation/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProfileForm({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { fullName },
  });

  function onSubmit(values: UpdateProfileInput) {
    startTransition(async () => {
      const result = await updateProfile(values);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Perfil atualizado.");
      }
    });
  }

  const { errors } = form.formState;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-name">Nome completo</Label>
        <Input
          id="profile-name"
          aria-invalid={!!errors.fullName}
          {...form.register("fullName")}
        />
        {errors.fullName && (
          <p className="text-destructive text-sm">{errors.fullName.message}</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-email">E-mail</Label>
        <Input id="profile-email" value={email} disabled readOnly />
        <p className="text-muted-foreground text-xs">
          O e-mail de acesso não pode ser alterado nesta versão.
        </p>
      </div>
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending && <Loader2 className="size-4 animate-spin" />}
        Salvar perfil
      </Button>
    </form>
  );
}
