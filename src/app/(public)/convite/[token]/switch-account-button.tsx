"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";

import { signOut } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";

export function SwitchAccountButton({ nextPath }: { nextPath: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await signOut(nextPath);
        })
      }
    >
      {isPending && <Loader2 className="size-4 animate-spin" />}
      Trocar de conta
    </Button>
  );
}
