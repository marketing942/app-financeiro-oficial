"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updatePassword } from "@/server/auth/actions";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/lib/validation/auth";

export function RedefinirForm() {
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  function onSubmit(values: ResetPasswordInput) {
    setServerError(undefined);
    startTransition(async () => {
      const result = await updatePassword(values);
      if (result && "error" in result) {
        setServerError(result.error);
      }
    });
  }

  const { errors } = form.formState;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Redefinir senha</CardTitle>
        <CardDescription>
          Escolha uma nova senha para sua conta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby={
                errors.password ? "password-error" : "password-hint"
              }
              {...form.register("password")}
            />
            {errors.password ? (
              <p id="password-error" className="text-destructive text-sm">
                {errors.password.message}
              </p>
            ) : (
              <p id="password-hint" className="text-muted-foreground text-xs">
                Pelo menos 8 caracteres.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              aria-describedby={
                errors.confirmPassword ? "confirmPassword-error" : undefined
              }
              {...form.register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p
                id="confirmPassword-error"
                className="text-destructive text-sm"
              >
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          {serverError && (
            <p role="alert" className="text-destructive text-sm">
              {serverError}{" "}
              <Link
                href="/recuperar-senha"
                className="text-primary underline-offset-4 hover:underline"
              >
                Solicitar novo link
              </Link>
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            Salvar nova senha
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
