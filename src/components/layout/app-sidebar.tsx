"use client";

import Link from "next/link";

import { Brand } from "@/components/brand";
import { Separator } from "@/components/ui/separator";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { NAV_ITEMS, SECONDARY_NAV_ITEMS } from "@/components/layout/nav-items";

export function AppSidebar() {
  return (
    <aside className="bg-sidebar border-sidebar-border fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r md:flex">
      <div className="flex h-14 items-center px-4">
        <Link href="/" aria-label="Ir para o Dashboard">
          <Brand />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <SidebarNav items={NAV_ITEMS} />
        <Separator className="my-3" />
        <SidebarNav items={SECONDARY_NAV_ITEMS} />
      </div>
    </aside>
  );
}
