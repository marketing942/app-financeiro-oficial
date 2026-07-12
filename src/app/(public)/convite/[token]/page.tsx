import type { Metadata } from "next";
import Link from "next/link";
import { MailQuestion, MailCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getInvitationPreview } from "@/server/workspaces/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcceptInviteButton } from "./accept-button";
import { SwitchAccountButton } from "./switch-account-button";

export const metadata: Metadata = { title: "Convite" };

const STATUS_MESSAGES: Record<string, string> = {
  accepted: "Este convite já foi utilizado.",
  expired: "Este convite expirou. Peça um novo link ao proprietário do espaço.",
  revoked: "Este convite foi revogado pelo proprietário do espaço.",
};

export default async function ConvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await getInvitationPreview(token);

  if (!preview || STATUS_MESSAGES[preview.status]) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <MailQuestion
            className="text-muted-foreground mx-auto size-10"
            aria-hidden="true"
          />
          <CardTitle>Convite indisponível</CardTitle>
          <CardDescription>
            {preview
              ? STATUS_MESSAGES[preview.status]
              : "Convite não encontrado. Confira o link recebido."}
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const invitePath = `/convite/${token}`;

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <MailCheck
          className="text-primary mx-auto size-10"
          aria-hidden="true"
        />
        <CardTitle>Convite para “{preview.workspaceName}”</CardTitle>
        <CardDescription>
          {preview.inviterName} convidou {preview.invitedEmail} para ser
          assistente deste espaço financeiro.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {user ? (
          user.email?.toLowerCase() === preview.invitedEmail.toLowerCase() ? (
            <AcceptInviteButton token={token} />
          ) : (
            <>
              <p className="text-destructive text-center text-sm" role="alert">
                Você está conectado como {user.email}, mas o convite é para{" "}
                {preview.invitedEmail}. Entre com a conta correta.
              </p>
              <SwitchAccountButton nextPath={invitePath} />
            </>
          )
        ) : (
          <>
            <p className="text-muted-foreground text-center text-sm">
              Para aceitar, entre com a conta {preview.invitedEmail} ou crie sua
              conta com esse e-mail.
            </p>
            <Button asChild>
              <Link href={`/login?next=${encodeURIComponent(invitePath)}`}>
                Entrar
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/cadastro">Criar conta</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
