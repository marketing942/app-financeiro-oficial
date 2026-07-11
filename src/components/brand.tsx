import { Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Landmark className="size-4" aria-hidden="true" />
      </span>
      <span className="text-base leading-tight font-semibold tracking-tight">
        Domínio <span className="text-primary">Financeiro</span>
      </span>
    </div>
  );
}
