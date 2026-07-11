import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Verifique seu e-mail" };

export default function VerificarEmailPage() {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <MailCheck
          className="text-primary mx-auto size-10"
          aria-hidden="true"
        />
        <CardTitle>Verifique seu e-mail</CardTitle>
        <CardDescription>
          Enviamos um link de confirmação para o seu e-mail. Abra a mensagem e
          clique no link para ativar sua conta.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-center">
        <p className="text-muted-foreground text-sm">
          Não recebeu? Verifique a caixa de spam ou tente novamente em alguns
          minutos.
        </p>
        <Button asChild variant="outline">
          <Link href="/login">Voltar para o login</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
