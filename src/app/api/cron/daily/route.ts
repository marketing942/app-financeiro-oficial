import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

// Cron diário (vercel.json): atrasos, horizonte de recorrências, alertas
// e expiração de conversas da Nylo. Autenticado por CRON_SECRET.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "service client not configured" },
      { status: 503 }
    );
  }

  const { data, error } = await supabase.rpc("run_daily_maintenance");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result: data });
}
