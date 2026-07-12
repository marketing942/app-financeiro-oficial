import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";

import { getActiveWorkspace } from "@/server/workspaces/queries";
import { listConversations, listMessages } from "@/server/nylo/queries";
import { Button } from "@/components/ui/button";
import { NyloChat } from "./nylo-chat";

export const metadata: Metadata = { title: "Nylo" };

export default async function NyloPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const { active } = await getActiveWorkspace();
  if (!active) return null;

  const conversations = await listConversations(active.id);
  const conversationId =
    c && conversations.some((conv) => conv.id === c) ? c : null;
  const messages = conversationId ? await listMessages(conversationId) : [];
  const configured = !!process.env.OPENAI_API_KEY;

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col gap-4 lg:flex-row">
      <aside
        className="flex w-full flex-col gap-2 lg:w-64"
        aria-label="Conversas"
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/nylo">
            <MessageSquarePlus />
            Nova conversa
          </Link>
        </Button>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-y-auto">
          {conversations.map((conv) => (
            <Link
              key={conv.id}
              href={`/nylo?c=${conv.id}`}
              aria-current={conv.id === conversationId ? "page" : undefined}
              className={`shrink-0 truncate rounded-md px-3 py-2 text-sm lg:shrink ${
                conv.id === conversationId
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {conv.title ?? "Conversa"}
            </Link>
          ))}
        </nav>
        <p className="text-muted-foreground mt-auto hidden text-xs lg:block">
          Suas conversas são privadas: nem outros membros do espaço as leem. A
          Nylo nunca cria lançamentos sem a sua confirmação.
        </p>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        {!configured && (
          <p
            role="alert"
            className="border-destructive/40 text-destructive mb-3 rounded-md border border-dashed p-3 text-sm"
          >
            A Nylo ainda não está configurada neste ambiente — a variável
            OPENAI_API_KEY precisa ser definida no servidor (ver
            docs/DEPLOYMENT.md). Nenhuma funcionalidade é simulada.
          </p>
        )}
        <NyloChat
          key={conversationId ?? "new"}
          conversationId={conversationId}
          initialMessages={messages}
        />
      </div>
    </div>
  );
}
