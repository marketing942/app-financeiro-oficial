import type { Metadata } from "next";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <UnderConstruction
      title="Dashboard"
      phase="Fase 11"
      description="O Dashboard completo (resumo do período, previsto × realizado, regra 50/20/30, patrimônio, metas e alertas) será implementado na Fase 11, alimentado pelos módulos das fases anteriores. Nenhum dado simulado é exibido aqui."
    />
  );
}
