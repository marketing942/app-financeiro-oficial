"use client";

import { useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BellRing,
  Check,
  CircleAlert,
  Info,
  PartyPopper,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { markAlertSeen, refreshAlerts } from "@/server/dashboard/actions";
import type { Alert } from "@/server/dashboard/queries";
import { formatBRL } from "@/lib/finance/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SEVERITY_ICON = {
  info: Info,
  attention: AlertTriangle,
  critical: CircleAlert,
  success: PartyPopper,
} as const;

const SEVERITY_CLASS = {
  info: "text-muted-foreground",
  attention: "text-amber-600 dark:text-amber-500",
  critical: "text-destructive",
  success: "text-primary",
} as const;

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await refreshAlerts();
      if ("error" in result) toast.error(result.error);
      else toast.success("Alertas recalculados.");
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4" aria-hidden="true" />
          Alertas
        </CardTitle>
        <Button
          size="sm"
          variant="ghost"
          onClick={refresh}
          disabled={isPending}
          aria-label="Recalcular alertas"
        >
          <RefreshCw className={isPending ? "animate-spin" : ""} />
          Recalcular
        </Button>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum alerta ativo — tudo em dia. Use “Recalcular” para verificar
            agora.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {alerts.map((alert) => {
              const Icon = SEVERITY_ICON[alert.severity];
              return (
                <li key={alert.id} className="flex items-start gap-2 text-sm">
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${SEVERITY_CLASS[alert.severity]}`}
                    aria-label={alert.severity}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        alert.seenAt ? "text-muted-foreground" : "font-medium"
                      }
                    >
                      {alert.actionUrl ? (
                        <Link
                          href={alert.actionUrl}
                          className="hover:underline"
                        >
                          {alert.title}
                        </Link>
                      ) : (
                        alert.title
                      )}
                    </p>
                    {alert.body && (
                      <p className="text-muted-foreground text-xs">
                        {alert.body}
                      </p>
                    )}
                    {alert.amount && (
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {formatBRL(alert.amount)}
                      </p>
                    )}
                  </div>
                  {!alert.seenAt && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Marcar "${alert.title}" como visto`}
                      onClick={() =>
                        startTransition(async () => {
                          await markAlertSeen({ alertId: alert.id });
                        })
                      }
                    >
                      <Check />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
