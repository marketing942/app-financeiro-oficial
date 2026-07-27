"use client";

import { deleteYield } from "@/server/investments/actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";

export function YieldDeleteButton({
  yieldId,
  label,
}: {
  yieldId: string;
  label: string;
}) {
  return (
    <ConfirmDeleteButton
      ariaLabel={`Excluir rendimento de ${label}`}
      title="Excluir rendimento?"
      description="O rendimento será removido e o saldo do investimento recalculado."
      successMessage="Rendimento excluído."
      onConfirm={() => deleteYield({ yieldId })}
    />
  );
}
