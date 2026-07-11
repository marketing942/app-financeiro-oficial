import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Troca o código (PKCE) vindo dos links de e-mail (confirmação, recuperação,
// convite) por uma sessão e redireciona para o destino.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Apenas caminhos internos são destinos válidos.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?erro=link-invalido`);
}
