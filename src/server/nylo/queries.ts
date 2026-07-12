import { createClient } from "@/lib/supabase/server";
import type { NyloStructuredContent } from "@/lib/ai/schemas";

export type NyloConversation = {
  id: string;
  title: string | null;
  updatedAt: string;
};

export type NyloMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  contentJson: NyloStructuredContent | null;
  createdAt: string;
};

export async function listConversations(
  workspaceId: string
): Promise<NyloConversation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(30);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
  }));
}

export async function listMessages(
  conversationId: string
): Promise<NyloMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_messages")
    .select("id, role, content, content_json, created_at")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(200);
  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    contentJson: (row.content_json as NyloStructuredContent) ?? null,
    createdAt: row.created_at,
  }));
}
