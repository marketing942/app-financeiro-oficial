"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { createCategory, updateCategory } from "@/server/categories/actions";
import type { Category } from "@/server/categories/queries";
import type { CategoryKind } from "@/lib/validation/finance";
import { COLOR_PALETTE, ICON_NAMES, getIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

const nameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome.")
    .max(60, "Nome muito longo."),
});

type NameInput = z.infer<typeof nameSchema>;

export function CategoryDialog({
  kind,
  category,
}: {
  kind: CategoryKind;
  category?: Category;
}) {
  const isEdit = !!category;
  const [open, setOpen] = useState(false);
  const [icon, setIcon] = useState<string | undefined>(
    category?.icon ?? undefined
  );
  const [color, setColor] = useState<string | undefined>(
    category?.color ?? undefined
  );
  const [serverError, setServerError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const form = useForm<NameInput>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: category?.name ?? "" },
  });

  function onSubmit(values: NameInput) {
    setServerError(undefined);
    startTransition(async () => {
      const result = isEdit
        ? await updateCategory({
            categoryId: category.id,
            name: values.name,
            icon,
            color,
          })
        : await createCategory({ kind, name: values.name, icon, color });
      if ("error" in result) {
        setServerError(result.error);
      } else {
        toast.success(isEdit ? "Categoria atualizada." : "Categoria criada.");
        setOpen(false);
        if (!isEdit) {
          form.reset();
          setIcon(undefined);
          setColor(undefined);
        }
      }
    });
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Editar categoria ${category.name}`}
          >
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus />
            Nova categoria
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Editar “${category.name}”` : "Nova categoria"}
          </DialogTitle>
          <DialogDescription>
            Categorias organizam seus lançamentos. Arquivar uma categoria nunca
            apaga os lançamentos já registrados.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="category-name">Nome</Label>
            <Input
              id="category-name"
              aria-invalid={!!errors.name}
              {...form.register("name")}
            />
            {errors.name && (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Ícone</legend>
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {ICON_NAMES.map((name) => {
                const IconComponent = getIcon(name);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-label={`Ícone ${name}`}
                    aria-pressed={icon === name}
                    onClick={() => setIcon(icon === name ? undefined : name)}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-md border",
                      icon === name
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-transparent hover:bg-accent/50"
                    )}
                  >
                    <IconComponent className="size-4" />
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Cor</legend>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Cor ${hex}`}
                  aria-pressed={color === hex}
                  onClick={() => setColor(color === hex ? undefined : hex)}
                  className={cn(
                    "size-6 rounded-full border-2 transition-transform",
                    color === hex
                      ? "border-foreground scale-110"
                      : "border-transparent"
                  )}
                  style={{ backgroundColor: hex }}
                />
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
            {isEdit ? "Salvar categoria" : "Criar categoria"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
