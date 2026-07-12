import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente administrativo (service_role) — SOMENTE para rotinas de cron.
// Jamais importar em código que possa parar no bundle do cliente.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
