"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/server/workspaces/queries";

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

type ActionResult = { error: string } | { success: true };

export async function refreshAlerts(): Promise<ActionResult> {
  const supabase = await createClient();
  const { active } = await getActiveWorkspace();
  if (!active) return { error: GENERIC_ERROR };

  const { error } = await supabase.rpc("recompute_alerts", {
    p_workspace: active.id,
  });
  if (error) return { error: GENERIC_ERROR };

  revalidatePath("/");
  return { success: true };
}

export async function markAlertSeen(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ alertId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("mark_alert_seen", {
    p_alert: parsed.data.alertId,
  });
  if (error || !data) return { error: GENERIC_ERROR };

  revalidatePath("/");
  return { success: true };
}
