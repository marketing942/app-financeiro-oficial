import { MobileMenu } from "@/components/layout/mobile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import type { WorkspaceSummary } from "@/server/workspaces/queries";

export function AppHeader({
  userName,
  userEmail,
  activeWorkspace,
  workspaces,
}: {
  userName: string | null;
  userEmail: string;
  activeWorkspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
}) {
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-4 backdrop-blur md:px-6">
      <MobileMenu />
      {activeWorkspace && (
        <WorkspaceSwitcher active={activeWorkspace} all={workspaces} />
      )}
      <div className="flex-1" />
      <ThemeToggle />
      <UserMenu name={userName} email={userEmail} />
    </header>
  );
}
