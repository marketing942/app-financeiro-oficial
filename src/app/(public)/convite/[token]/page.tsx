import type { Metadata } from "next";
import Link from "next/link";
import { MailQuestion } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Convite" };

// O fluxo completo de convites (validação de token, aceite e permissões)
// é implementado na Fase 2. Esta página apenas informa o estado atual.
export default function ConvitePage() {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <MailQuestion
          className="text-muted-foreground mx-auto size-10"
          aria-hidden="true"
        />
        <CardTitle>Convites ainda não disponíveis</CardTitle>
        <CardDescription>
          O sistema de convites para assistentes será habilitado na Fase 2 do
          desenvolvimento. Este link ainda não pode ser processado.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <Button asChild variant="outline">
          <Link href="/login">Ir para o login</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
