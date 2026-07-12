"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type { NyloStructuredContent } from "@/lib/ai/schemas";
import type { NyloMessage } from "@/server/nylo/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NyloChart } from "./nylo-chart";
import { DraftCard } from "./draft-card";

const SUGGESTIONS = [
  "Como foi meu mês até agora?",
  "Estou dentro da regra 50/20/30?",
  "Quais contas vencem nos próximos 15 dias?",
  "Como está o ritmo das minhas metas?",
  "Mostre a distribuição das minhas despesas em um gráfico",
];

type LiveMessage = {
  role: "user" | "assistant";
  content: string;
  contentJson: NyloStructuredContent | null;
};

function StructuredBlocks({ blocks }: { blocks: NyloStructuredContent }) {
  return (
    <div className="flex flex-col gap-3">
      {blocks.chart && <NyloChart chart={blocks.chart} />}
      {blocks.report && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="text-muted-foreground p-2 text-left text-xs">
              {blocks.report.title} — {blocks.report.periodFrom} a{" "}
              {blocks.report.periodTo}
            </caption>
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                {blocks.report.columns.map((col) => (
                  <th key={col} className="p-2 font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blocks.report.rows.map((row, index) => (
                <tr key={index} className="border-b last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="p-2 tabular-nums">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {blocks.draft && <DraftCard draft={blocks.draft} />}
      {blocks.marketDisclaimer && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-2 text-xs">
          Conteúdo educacional sobre mercado financeiro: não é recomendação de
          investimento, não há garantia de rentabilidade e resultados passados
          não asseguram resultados futuros. Avalie custos, liquidez, tributação
          e o seu perfil antes de qualquer decisão.
        </p>
      )}
    </div>
  );
}

export function NyloChat({
  conversationId,
  initialMessages,
}: {
  conversationId: string | null;
  initialMessages: NyloMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<LiveMessage[]>(
    initialMessages.map((m) => ({
      role: m.role,
      content: m.content,
      contentJson: m.contentJson,
    }))
  );
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeConversation, setActiveConversation] = useState(conversationId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || isStreaming) return;
    setInput("");
    setIsStreaming(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: message, contentJson: null },
      { role: "assistant", content: "", contentJson: null },
    ]);

    try {
      const response = await fetch("/api/nylo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversation ?? undefined,
          message,
        }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "A Nylo está indisponível agora.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let newConversationId: string | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) {
          const line = raw.replace(/^data: /, "").trim();
          if (!line) continue;
          const event = JSON.parse(line) as {
            type: string;
            delta?: string;
            payload?: NyloStructuredContent;
            conversationId?: string;
            message?: string;
          };
          if (event.type === "conversation" && event.conversationId) {
            newConversationId = event.conversationId;
          } else if (event.type === "text" && event.delta) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = {
                ...last,
                content: last.content + event.delta,
              };
              return next;
            });
          } else if (event.type === "structured" && event.payload) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = {
                ...last,
                contentJson: { ...last.contentJson, ...event.payload },
              };
              return next;
            });
          } else if (event.type === "error") {
            toast.error(event.message ?? "Erro na Nylo.");
          }
        }
      }

      if (newConversationId && !activeConversation) {
        setActiveConversation(newConversationId);
        router.replace(`/nylo?c=${newConversationId}`, { scroll: false });
        router.refresh();
      }
    } catch (error) {
      setMessages((prev) => prev.slice(0, -1));
      toast.error(
        error instanceof Error ? error.message : "A Nylo está indisponível."
      );
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1"
        aria-live="polite"
        aria-label="Conversa com a Nylo"
      >
        {messages.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <Sparkles className="text-primary size-8" aria-hidden="true" />
              <p className="font-medium">
                Oi! Eu sou a Nylo, sua assistente do Domínio Financeiro.
              </p>
              <p className="text-muted-foreground max-w-md text-sm">
                Analiso seus números direto do banco de dados — nunca invento
                valores. Lançamentos só acontecem com a sua confirmação.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    size="sm"
                    variant="outline"
                    onClick={() => send(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "bg-primary text-primary-foreground ml-auto max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2 text-sm whitespace-pre-wrap"
                : "flex max-w-[95%] flex-col gap-3"
            }
          >
            {message.role === "user" ? (
              message.content
            ) : (
              <>
                {message.content ? (
                  <div className="bg-muted/60 rounded-2xl rounded-bl-sm px-4 py-2 text-sm whitespace-pre-wrap">
                    {message.content}
                  </div>
                ) : (
                  isStreaming &&
                  index === messages.length - 1 && (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                      Nylo está analisando…
                    </div>
                  )
                )}
                {message.contentJson && (
                  <StructuredBlocks blocks={message.contentJson} />
                )}
              </>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Pergunte sobre suas finanças…"
          aria-label="Mensagem para a Nylo"
          disabled={isStreaming}
        />
        <Button type="submit" disabled={isStreaming || !input.trim()}>
          {isStreaming ? <Loader2 className="size-4 animate-spin" /> : <Send />}
          Enviar
        </Button>
      </form>
    </div>
  );
}
