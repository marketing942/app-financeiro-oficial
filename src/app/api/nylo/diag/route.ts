import { NextResponse } from "next/server";
import OpenAI from "openai";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Diagnóstico da Nylo (autenticado). Abra no navegador para ver, em texto,
// exatamente o que está errado com a configuração da OpenAI — sem precisar
// ler logs. Não expõe dados financeiros nem a chave; só o resultado do teste.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Faça login primeiro." }, {
      status: 401,
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o";

  const report: Record<string, unknown> = {
    tem_OPENAI_API_KEY: !!apiKey,
    OPENAI_MODEL: model,
    runtime: "nodejs",
  };

  if (!apiKey) {
    report.diagnostico =
      "OPENAI_API_KEY não está configurada no servidor (ou o deploy não foi refeito depois de adicioná-la).";
    return NextResponse.json(report, { status: 200 });
  }

  const openai = new OpenAI({ apiKey });
  const started = Date.now();

  try {
    const response = await openai.responses.create({
      model,
      input: "Responda apenas: ok",
      max_output_tokens: 16,
    });
    report.ok = true;
    report.duracao_ms = Date.now() - started;
    report.resposta = response.output_text ?? "(sem texto)";
    report.diagnostico =
      "A OpenAI respondeu normalmente. Se o chat ainda falha, o problema é tempo de execução (timeout da função na Vercel) ou uma etapa posterior — verifique o plano/limite de duração da Vercel.";
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    report.ok = false;
    report.duracao_ms = Date.now() - started;
    if (error instanceof OpenAI.APIError) {
      report.tipo = "OpenAI.APIError";
      report.status = error.status;
      report.code = error.code;
      report.mensagem = error.message;
      if (error.status === 401) {
        report.diagnostico = "Chave da OpenAI inválida.";
      } else if (error.status === 404 || error.code === "model_not_found") {
        report.diagnostico = `O modelo "${model}" não existe ou sua conta não tem acesso a ele. Use um modelo listado em platform.openai.com/settings/organization/limits ou tente 'gpt-4o'.`;
      } else if (error.status === 429) {
        report.diagnostico =
          "Sem saldo/cota na OpenAI (429). Adicione crédito em platform.openai.com → Billing.";
      } else {
        report.diagnostico = "A OpenAI recusou a requisição — veja a mensagem.";
      }
    } else {
      report.tipo = "erro_desconhecido";
      report.mensagem =
        error instanceof Error ? error.message : String(error);
      report.diagnostico =
        "Erro não relacionado à API da OpenAI (rede, timeout ou código).";
    }
    return NextResponse.json(report, { status: 200 });
  }
}
