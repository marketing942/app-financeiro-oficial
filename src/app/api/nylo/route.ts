import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/server/workspaces/queries";
import { buildContextBlock, NYLO_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import {
  findTool,
  isToolAllowed,
  NYLO_TOOLS,
  type ToolContext,
} from "@/lib/ai/tools";
import {
  checkRateLimit,
  NYLO_CONVERSATION_MESSAGE_LIMIT,
} from "@/lib/ai/rate-limit";
import type { NyloStructuredContent } from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_MESSAGES = 30;
const DEFAULT_MODEL = "claude-opus-4-8";

const requestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  periodFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  periodTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "A Nylo não está configurada neste ambiente (ANTHROPIC_API_KEY ausente).",
      },
      { status: 503 }
    );
  }

  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Requisição inválida." },
      {
        status: 400,
      }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  const { active } = await getActiveWorkspace();
  if (!active) {
    return NextResponse.json({ error: "Sem espaço ativo." }, { status: 403 });
  }

  // Rate limiting por usuário e por workspace (base: ai_usage_logs).
  const { data: rateRows } = await supabase.rpc("nylo_rate_status", {
    p_workspace: active.id,
  });
  const rate = (rateRows as Record<string, unknown>[] | null)?.[0];
  const decision = checkRateLimit({
    userMessagesToday: Number(rate?.user_messages_today ?? 0),
    workspaceMessagesMonth: Number(rate?.workspace_messages_month ?? 0),
    monthlyLimit:
      rate?.monthly_limit === null || rate?.monthly_limit === undefined
        ? null
        : Number(rate.monthly_limit),
  });
  if (!decision.allowed) {
    return NextResponse.json({ error: decision.reason }, { status: 429 });
  }

  // Conversa: cria ou reutiliza (RLS garante que é do próprio usuário).
  let conversationId = body.data.conversationId ?? null;
  if (conversationId) {
    const { data: conv } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) {
      return NextResponse.json(
        { error: "Conversa não encontrada." },
        {
          status: 404,
        }
      );
    }
  } else {
    const { data: conv, error } = await supabase
      .from("ai_conversations")
      .insert({
        workspace_id: active.id,
        user_id: user.id,
        title: body.data.message.slice(0, 80),
      })
      .select("id")
      .single();
    if (error || !conv) {
      return NextResponse.json(
        { error: "Falha ao criar conversa." },
        {
          status: 500,
        }
      );
    }
    conversationId = conv.id;
  }

  const { count: messageCount } = await supabase
    .from("ai_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  if ((messageCount ?? 0) >= NYLO_CONVERSATION_MESSAGE_LIMIT) {
    return NextResponse.json(
      { error: "Esta conversa atingiu o limite de mensagens. Crie uma nova." },
      { status: 429 }
    );
  }

  const { data: history } = await supabase
    .from("ai_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  await supabase.from("ai_messages").insert({
    conversation_id: conversationId,
    workspace_id: active.id,
    user_id: user.id,
    role: "user",
    content: body.data.message,
  });

  const defaults = currentMonthRange();
  const toolCtx: ToolContext = {
    supabase,
    workspaceId: active.id,
    role: active.role,
    permissions: active.permissions,
    periodFrom: body.data.periodFrom ?? defaults.from,
    periodTo: body.data.periodTo ?? defaults.to,
  };

  const anthropic = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const system = `${NYLO_SYSTEM_PROMPT}\n\n${buildContextBlock({
    workspaceName: active.name,
    role: active.role,
    periodFrom: toolCtx.periodFrom,
    periodTo: toolCtx.periodTo,
    today: new Date().toISOString().slice(0, 10),
  })}`;

  const tools: Anthropic.Tool[] = NYLO_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.schema) as Anthropic.Tool.InputSchema,
  }));

  // Histórico (mais antigo → mais novo) + a mensagem atual.
  const messages: Anthropic.MessageParam[] = [
    ...(history ?? [])
      .reverse()
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user" as const, content: body.data.message },
  ];

  const encoder = new TextEncoder();
  const structuredBlocks: NyloStructuredContent = {};
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(sse(payload)));

      try {
        send({ type: "conversation", conversationId });

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const messageStream = anthropic.messages.stream({
            model,
            max_tokens: 2048,
            system,
            tools,
            messages,
          });

          for await (const event of messageStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              fullText += event.delta.text;
              send({ type: "text", delta: event.delta.text });
            }
          }

          const final = await messageStream.finalMessage();
          inputTokens += final.usage.input_tokens;
          outputTokens += final.usage.output_tokens;

          if (final.stop_reason !== "tool_use") break;

          // Fecha o turno do assistente (texto + chamadas de ferramenta) e
          // devolve os resultados no turno seguinte do usuário.
          messages.push({ role: "assistant", content: final.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            const started = Date.now();
            const tool = findTool(block.name);
            let output: string;
            let isError = false;
            let status: "ok" | "denied" | "error" = "ok";
            let summary = "";

            if (!tool) {
              status = "error";
              isError = true;
              output = JSON.stringify({ erro: "ferramenta inexistente" });
            } else if (!isToolAllowed(tool, active.role, active.permissions)) {
              status = "denied";
              isError = true;
              summary = "Permissão negada";
              output = JSON.stringify({
                erro: "sem permissão para esta ferramenta — informe o usuário",
              });
            } else {
              try {
                const result = await tool.execute(toolCtx, block.input);
                summary = result.summary;
                output = JSON.stringify(result.data);
                if (result.structured) {
                  Object.assign(structuredBlocks, result.structured);
                  send({ type: "structured", payload: result.structured });
                }
              } catch {
                status = "error";
                isError = true;
                output = JSON.stringify({
                  erro: "falha ao executar a consulta",
                });
              }
            }

            await supabase.from("ai_tool_calls").insert({
              workspace_id: active.id,
              user_id: user.id,
              tool_name: block.name,
              arguments: block.input as Record<string, unknown>,
              result_summary: summary || null,
              status,
              duration_ms: Date.now() - started,
            });

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: output,
              is_error: isError,
            });
          }

          messages.push({ role: "user", content: toolResults });
        }

        // Persistência da resposta + uso/custo.
        const hasStructured = Object.keys(structuredBlocks).length > 0;
        await supabase.from("ai_messages").insert({
          conversation_id: conversationId,
          workspace_id: active.id,
          user_id: user.id,
          role: "assistant",
          content: fullText,
          content_json: hasStructured ? structuredBlocks : null,
          token_count: outputTokens,
        });

        const inCost = Number(process.env.ANTHROPIC_INPUT_COST_PER_MTOK ?? 0);
        const outCost = Number(process.env.ANTHROPIC_OUTPUT_COST_PER_MTOK ?? 0);
        await supabase.from("ai_usage_logs").insert({
          workspace_id: active.id,
          user_id: user.id,
          conversation_id: conversationId,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: (
            (inputTokens * inCost + outputTokens * outCost) /
            1_000_000
          ).toFixed(6),
        });

        send({ type: "done" });
      } catch (error) {
        // Loga o erro real (aparece nos logs da Vercel) e devolve uma
        // mensagem específica para as falhas de configuração comuns.
        console.error("[nylo] falha ao gerar resposta:", error);
        let message = "A Nylo encontrou um problema. Tente novamente.";
        if (error instanceof Anthropic.APIError) {
          if (error.status === 401) {
            message =
              "Chave da Anthropic inválida. Verifique ANTHROPIC_API_KEY no servidor.";
          } else if (error.status === 404) {
            message = `Modelo de IA "${model}" não encontrado. Ajuste a variável ANTHROPIC_MODEL.`;
          } else if (error.status === 429) {
            message =
              "Limite/cota da Anthropic atingido. Verifique o saldo e o billing em console.anthropic.com.";
          } else if (error.status === 400) {
            message = `A Anthropic rejeitou a requisição: ${error.message}`;
          } else {
            message = `Erro da Anthropic (${error.status}): ${error.message}`;
          }
        } else if (error instanceof Error) {
          message = `A Nylo falhou: ${error.message.slice(0, 300)}`;
        }
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
