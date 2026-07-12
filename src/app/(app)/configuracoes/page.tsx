import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/server/workspaces/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProfileForm } from "./profile-form";
import { WorkspaceForm } from "./workspace-form";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .maybeSingle();

  const { active } = await getActiveWorkspace();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>

      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>Seus dados pessoais de acesso.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            fullName={profile?.full_name ?? ""}
            email={user?.email ?? ""}
          />
        </CardContent>
      </Card>

      {active && active.role === "owner" && (
        <Card>
          <CardHeader>
            <CardTitle>Espaço financeiro</CardTitle>
            <CardDescription>
              Configurações do espaço “{active.name}”. Demais preferências
              (início do mês, tolerâncias, categorias essenciais) chegam nas
              próximas fases junto com os módulos que as utilizam.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceForm name={active.name} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tema</CardTitle>
          <CardDescription>
            Alterne entre claro, escuro e automático pelo botão de tema no topo
            da página. A preferência fica salva neste dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
