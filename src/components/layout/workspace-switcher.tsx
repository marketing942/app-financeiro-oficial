"use client";

import { useTransition } from "react";
import { Check, ChevronsUpDown, Landmark } from "lucide-react";

import { setActiveWorkspace } from "@/server/workspaces/actions";
import type { WorkspaceSummary } from "@/server/workspaces/queries";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceSwitcher({
  active,
  all,
}: {
  active: WorkspaceSummary;
  all: WorkspaceSummary[];
}) {
  const [isPending, startTransition] = useTransition();

  if (all.length <= 1) {
    return (
      <span className="text-muted-foreground hidden max-w-48 truncate text-sm font-medium sm:inline">
        {active.name}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          className="max-w-56 justify-start gap-2"
          aria-label="Trocar espaço financeiro"
        >
          <Landmark className="size-4 shrink-0" />
          <span className="truncate">{active.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Espaços financeiros</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {all.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => {
              if (workspace.id !== active.id) {
                startTransition(async () => {
                  await setActiveWorkspace(workspace.id);
                });
              }
            }}
          >
            <span className="flex-1 truncate">{workspace.name}</span>
            {workspace.id === active.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
