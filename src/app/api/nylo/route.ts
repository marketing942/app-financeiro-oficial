import { NextResponse } from "next/server";
import OpenAI from "openai";
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "A Nylo não está configurada neste ambiente (OPENAI_API_KEY ausente).",
      },
      { status: 503 }
    );
  }

  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Requisição inválida." },
      { status: 400 }
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
        { status: 404 }
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

  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-5";
  const instructions = `${NYLO_SYSTEM_PROMPT}\n\n${buildContextBlock({
    workspaceName: active.name,
    role: active.role,
    periodFrom: toolCtx.periodFrom,
    periodTo: toolCtx.periodTo,
    today: new Date().toISOString().slice(0, 10),
  })}`;

  const openaiTools = NYLO_TOOLS.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.schema) as Record<string, unknown>,
    strict: false,
  }));

  const initialInput: OpenAI.Responses.ResponseInput = [
    ...(history ?? [])
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
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

        let input: OpenAI.Responses.ResponseInput = initialInput;
        let previousResponseId: string | undefined;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const response = openai.responses.stream({
            model,
            instructions,
            input,
            tools: openaiTools,
            previous_response_id: previousResponseId,
            max_output_tokens: 2048,
          });

          for await (const event of response) {
            if (event.type === "response.output_text.delta") {
              fullText += event.delta;
              send({ type: "text", delta: event.delta });
            }
          }

          const final = await response.finalResponse();
          previousResponseId = final.id;
          inputTokens += final.usage?.input_tokens ?? 0;
          outputTokens += final.usage?.output_tokens ?? 0;

          const functionCalls = final.output.filter(
            (item) => item.type === "function_call"
          );
          if (functionCalls.length === 0) break;

          const outputs: OpenAI.Responses.ResponseInput = [];
          for (const call of functionCalls) {
            const started = Date.now();
            const tool = findTool(call.name);
            let output: string;
            let status: "ok" | "denied" | "error" = "ok";
            let summary = "";

            if (!tool) {
              status = "error";
              output = JSON.stringify({ erro: "ferramenta inexistente" });
            } else if (!isToolAllowed(tool, active.role, active.permissions)) {
              status = "denied";
              summary = "Permissão negada";
              output = JSON.stringify({
                erro: "sem permissão para esta ferramenta — informe o usuário",
              });
            } else {
              try {
                const result = await tool.execute(
                  toolCtx,
                  JSON.parse(call.arguments || "{}")
                );
                summary = result.summary;
                output = JSON.stringify(result.data);
                if (result.structured) {
                  Object.assign(structuredBlocks, result.structured);
                  send({ type: "structured", payload: result.structured });
                }
              } catch {
                status = "error";
                output = JSON.stringify({
                  erro: "falha ao executar a consulta",
                });
              }
            }

            await supabase.from("ai_tool_calls").insert({
              workspace_id: active.id,
              user_id: user.id,
              tool_name: call.name,
              arguments: JSON.parse(call.arguments || "{}"),
              result_summary: summary || null,
              status,
              duration_ms: Date.now() - started,
            });

            outputs.push({
              type: "function_call_output",
              call_id: call.call_id,
              output,
            });
          }
          input = outputs;
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

        const inCost = Number(process.env.OPENAI_INPUT_COST_PER_MTOK ?? 0);
        const outCost = Number(process.env.OPENAI_OUTPUT_COST_PER_MTOK ?? 0);
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
      } catch {
        send({
          type: "error",
          message: "A Nylo encontrou um problema. Tente novamente.",
        });
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
