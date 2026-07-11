"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { ALL_NAV_ITEMS, MOBILE_NAV_HREFS } from "@/components/layout/nav-items";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = MOBILE_NAV_HREFS.map((href) =>
    ALL_NAV_ITEMS.find((item) => item.href === href)!
  );
  const rest = ALL_NAV_ITEMS.filter(
    (item) => !MOBILE_NAV_HREFS.includes(item.href)
  );
  const restActive = rest.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  return (
    <nav
      aria-label="Navegação inferior"
      className="bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur md:hidden"
    >
      <div className="grid grid-cols-5">
        {primary.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="size-5" aria-hidden="true" />
              {item.title}
            </Link>
          );
        })}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                restActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <MoreHorizontal className="size-5" aria-hidden="true" />
              Mais
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[70svh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Mais opções</SheetTitle>
            </SheetHeader>
            <div className="px-3 pb-6">
              <SidebarNav items={rest} onNavigate={() => setMoreOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
