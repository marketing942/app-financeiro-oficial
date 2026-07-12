"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { renameWorkspace } from "@/server/workspaces/actions";
import {
  renameWorkspaceSchema,
  type RenameWorkspaceInput,
} from "@/lib/validation/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkspaceForm({ name }: { name: string }) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<RenameWorkspaceInput>({
    resolver: zodResolver(renameWorkspaceSchema),
    defaultValues: { name },
  });

  function onSubmit(values: RenameWorkspaceInput) {
    startTransition(async () => {
      const result = await renameWorkspace(values);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Espaço renomeado.");
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
        <Label htmlFor="workspace-name">Nome do espaço</Label>
        <Input
          id="workspace-name"
          aria-invalid={!!errors.name}
          {...form.register("name")}
        />
        {errors.name && (
          <p className="text-destructive text-sm">{errors.name.message}</p>
        )}
      </div>
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending && <Loader2 className="size-4 animate-spin" />}
        Salvar espaço
      </Button>
    </form>
  );
}
