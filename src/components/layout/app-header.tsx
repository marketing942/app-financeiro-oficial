import { MobileMenu } from "@/components/layout/mobile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";

export function AppHeader({
  userName,
  userEmail,
}: {
  userName: string | null;
  userEmail: string;
}) {
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-4 backdrop-blur md:px-6">
      <MobileMenu />
      <div className="flex-1" />
      <ThemeToggle />
      <UserMenu name={userName} email={userEmail} />
    </header>
  );
}
