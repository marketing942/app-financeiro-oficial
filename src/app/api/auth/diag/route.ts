import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Diagnóstico de autenticação (público). Abra no navegador para ver, em texto,
// se o app consegue falar com o Supabase Auth. Não expõe chaves nem dados —
// só a presença das variáveis e o resultado do teste de conectividade.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const report: Record<string, unknown> = {
    tem_NEXT_PUBLIC_SUPABASE_URL: !!url,
    tem_NEXT_PUBLIC_SUPABASE_ANON_KEY: !!anon,
    // Host mascarado só para conferir que aponta para o projeto certo.
    supabase_host: url ? (() => {
      try {
        return new URL(url).host;
      } catch {
        return "(URL inválida)";
      }
    })() : null,
    runtime: "nodejs",
  };

  if (!url || !anon) {
    report.diagnostico =
      "Variáveis do Supabase ausentes no servidor. Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel e refaça o deploy.";
    return NextResponse.json(report, { status: 200 });
  }

  const started = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    report.auth_health_status = response.status;
    report.duracao_ms = Date.now() - started;

    if (response.ok) {
      report.ok = true;
      report.diagnostico =
        "O Supabase Auth respondeu normalmente. Se o login ainda falha, o problema é a senha, a confirmação de e-mail, ou uma etapa posterior — veja os logs da Vercel ([auth] signIn falhou).";
    } else if (response.status === 401 || response.status === 403) {
      report.ok = false;
      report.diagnostico =
        "O servidor respondeu, mas a chave (ANON_KEY) parece inválida para este projeto. Confira NEXT_PUBLIC_SUPABASE_ANON_KEY e se a URL é do MESMO projeto.";
    } else {
      report.ok = false;
      report.diagnostico = `O servidor respondeu com status ${response.status}. Pode ser indisponibilidade temporária do Supabase.`;
    }
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    report.ok = false;
    report.duracao_ms = Date.now() - started;
    report.erro = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && error.name === "AbortError";
    report.diagnostico = aborted
      ? "A conexão com o Supabase expirou (timeout). O projeto provavelmente está PAUSADO (projetos gratuitos pausam após ~7 dias sem uso) — entre em app.supabase.com e clique em 'Restore'/'Resume'. Pode também ser URL errada."
      : "Não foi possível conectar ao Supabase. Causas prováveis: projeto pausado, NEXT_PUBLIC_SUPABASE_URL errada, ou o deploy não recebeu as variáveis. Verifique no painel do Supabase e na Vercel.";
    return NextResponse.json(report, { status: 200 });
  }
}
