import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Diagnóstico da Nylo (autenticado). Abra no navegador para ver, em texto,
// exatamente o que está errado com a configuração da Anthropic — sem precisar
// ler logs. Não expõe dados financeiros nem a chave; só o resultado do teste.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Faça login primeiro." },
      {
        status: 401,
      }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

  const report: Record<string, unknown> = {
    tem_ANTHROPIC_API_KEY: !!apiKey,
    ANTHROPIC_MODEL: model,
    runtime: "nodejs",
  };

  if (!apiKey) {
    report.diagnostico =
      "ANTHROPIC_API_KEY não está configurada no servidor (ou o deploy não foi refeito depois de adicioná-la).";
    return NextResponse.json(report, { status: 200 });
  }

  const anthropic = new Anthropic({ apiKey });
  const started = Date.now();

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Responda apenas: ok" }],
    });
    const text = response.content.find((b) => b.type === "text");
    report.ok = true;
    report.duracao_ms = Date.now() - started;
    report.resposta = text?.type === "text" ? text.text : "(sem texto)";
    report.diagnostico =
      "A Anthropic respondeu normalmente. Se o chat ainda falha, o problema é tempo de execução (timeout da função na Vercel) ou uma etapa posterior.";
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    report.ok = false;
    report.duracao_ms = Date.now() - started;
    if (error instanceof Anthropic.APIError) {
      report.tipo = "Anthropic.APIError";
      report.status = error.status;
      report.mensagem = error.message;
      if (error.status === 401) {
        report.diagnostico =
          "Chave da Anthropic inválida. Gere uma nova em console.anthropic.com → API Keys.";
      } else if (error.status === 404) {
        report.diagnostico = `O modelo "${model}" não existe ou sua conta não tem acesso. Use 'claude-opus-4-8', 'claude-sonnet-5' ou 'claude-haiku-4-5'.`;
      } else if (error.status === 429) {
        report.diagnostico =
          "Sem saldo/cota na Anthropic (429). Adicione crédito em console.anthropic.com → Billing.";
      } else {
        report.diagnostico =
          "A Anthropic recusou a requisição — veja a mensagem.";
      }
    } else {
      report.tipo = "erro_desconhecido";
      report.mensagem = error instanceof Error ? error.message : String(error);
      report.diagnostico =
        "Erro não relacionado à API da Anthropic (rede, timeout ou código).";
    }
    return NextResponse.json(report, { status: 200 });
  }
}
