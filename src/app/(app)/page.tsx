import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Settings, UserPlus } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { active } = await getActiveWorkspace();

  return (
    <div className="flex flex-col gap-6">
      {active && (
        <Card>
          <CardHeader>
            <CardTitle>Bem-vindo(a) ao “{active.name}”</CardTitle>
            <CardDescription>
              Primeiros passos enquanto os módulos financeiros são construídos
              fase a fase:
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {active.role === "owner" && (
              <Button asChild variant="outline" size="sm">
                <Link href="/membros">
                  <UserPlus />
                  Convidar um assistente
                  <ArrowRight />
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/configuracoes">
                <Settings />
                Ajustar seu perfil e espaço
                <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <UnderConstruction
        title="Dashboard"
        phase="Fase 11"
        description="O Dashboard completo (resumo do período, previsto × realizado, regra 50/20/30, patrimônio, metas e alertas) será implementado na Fase 11, alimentado pelos módulos das fases anteriores. Nenhum dado simulado é exibido aqui."
      />
    </div>
  );
}
