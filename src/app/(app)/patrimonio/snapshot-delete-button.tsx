"use client";

import { deleteSnapshot } from "@/server/assets/actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";

export function SnapshotDeleteButton({
  snapshotId,
  label,
}: {
  snapshotId: string;
  label: string;
}) {
  return (
    <ConfirmDeleteButton
      ariaLabel={`Excluir snapshot de ${label}`}
      title="Excluir snapshot?"
      description={`O snapshot patrimonial de ${label} será removido definitivamente do histórico. Os demais registros não são afetados.`}
      successMessage="Snapshot excluído."
      onConfirm={() => deleteSnapshot({ snapshotId })}
    />
  );
}
