"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Result = { error: string } | { success: true };

// Botão de lixeira + diálogo de confirmação para ações destrutivas.
// Só deve ser usado dentro de Client Components (recebe `onConfirm`).
export function ConfirmDeleteButton({
  onConfirm,
  title,
  description,
  confirmLabel = "Excluir",
  successMessage,
  ariaLabel,
  size = "icon",
  className,
}: {
  onConfirm: () => Promise<Result>;
  title: string;
  description: string;
  confirmLabel?: string;
  successMessage: string;
  ariaLabel: string;
  size?: "icon" | "sm";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await onConfirm();
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(successMessage);
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
      >
        <Trash2 className={size === "icon" ? "size-3.5" : undefined} />
        {size === "sm" ? "Excluir" : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirm}
              disabled={isPending}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
