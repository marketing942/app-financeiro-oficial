import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/server/workspaces/queries";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/layout/bottom-nav";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Defesa em profundidade: o proxy já protege, mas o layout revalida.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  const { active, all } = await getActiveWorkspace();

  return (
    <div className="flex min-h-svh flex-col">
      <AppSidebar />
      <div className="flex flex-1 flex-col md:pl-60">
        <AppHeader
          userName={fullName}
          userEmail={user.email ?? ""}
          activeWorkspace={active}
          workspaces={all}
        />
        <main className="flex flex-1 flex-col p-4 pb-20 md:p-6 md:pb-6">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
