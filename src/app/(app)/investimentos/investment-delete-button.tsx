"use client";

import { deleteInvestment } from "@/server/investments/actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";

export function InvestmentDeleteButton({
  investmentId,
  investmentName,
}: {
  investmentId: string;
  investmentName: string;
}) {
  return (
    <ConfirmDeleteButton
      ariaLabel={`Excluir investimento ${investmentName}`}
      title={`Excluir “${investmentName}”?`}
      description="O investimento sai das listas e dos cálculos. O histórico de aportes é preservado (exclusão lógica) e pode ser recuperado no banco se necessário."
      successMessage="Investimento excluído."
      onConfirm={() => deleteInvestment({ investmentId })}
    />
  );
}
