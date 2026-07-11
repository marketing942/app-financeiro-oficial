import { Construction } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Placeholder honesto: nenhuma funcionalidade é simulada nem dado fictício
// é exibido. Cada módulo substitui esta tela na sua fase do plano
// (docs/IMPLEMENTATION_PLAN.md).
export function UnderConstruction({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description?: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card className="border-dashed">
        <CardHeader className="items-center py-10 text-center">
          <Construction
            className="text-muted-foreground mx-auto size-10"
            aria-hidden="true"
          />
          <CardTitle>Módulo em construção</CardTitle>
          <CardDescription className="max-w-md">
            {description ??
              `Esta área será implementada na ${phase} do plano de desenvolvimento. Nenhum dado simulado é exibido aqui.`}
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
