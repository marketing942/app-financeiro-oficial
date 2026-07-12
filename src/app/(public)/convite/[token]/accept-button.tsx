"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { acceptInvitation } from "@/server/workspaces/actions";
import { Button } from "@/components/ui/button";

export function AcceptInviteButton({ token }: { token: string }) {
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function accept() {
    setError(undefined);
    startTransition(async () => {
      const result = await acceptInvitation({ token });
      if (result && "error" in result) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button onClick={accept} disabled={isPending}>
        {isPending && <Loader2 className="size-4 animate-spin" />}
        Aceitar convite
      </Button>
    </div>
  );
}
