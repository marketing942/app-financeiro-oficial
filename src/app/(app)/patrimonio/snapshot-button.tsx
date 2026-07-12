"use client";

import { useTransition } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { takeSnapshot } from "@/server/assets/actions";
import { Button } from "@/components/ui/button";

export function SnapshotButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await takeSnapshot();
          if ("error" in result) {
            toast.error(result.error);
          } else {
            toast.success("Snapshot do patrimônio registrado para hoje.");
          }
        })
      }
    >
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera />}
      Registrar snapshot
    </Button>
  );
}
