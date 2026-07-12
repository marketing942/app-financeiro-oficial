"use client";

import { useState, useTransition } from "react";
import { HandCoins, Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { addValuation, sellAssetAction } from "@/server/assets/actions";
import {
  ASSET_STATUS_LABELS,
  ASSET_TYPE_LABELS,
  type Asset,
} from "@/lib/finance/assets";
import {
  decimalToCents,
  formatBRL,
  formatCentsBRL,
  parseMoneyInput,
} from "@/lib/finance/money";
import { formatDateBR } from "@/lib/finance/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Option = { id: string; name: string };

const VALUATION_EVENT_LABELS = {
  appraisal: "Avaliação profissional",
  appreciation: "Valorização",
  depreciation: "Desvalorização",
  improvement: "Benfeitoria/reforma",
  adjustment: "Ajuste manual",
} as const;

type ValuationEvent = keyof typeof VALUATION_EVENT_LABELS;

export function AssetCard({
  asset,
  accounts,
  canManage,
}: {
  asset: Asset;
  accounts: Option[];
  canManage: boolean;
}) {
  const [valOpen, setValOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [eventType, setEventType] = useState<ValuationEvent>("appraisal");
  const [value, setValue] = useState("");
  const [eventDate, setEventDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [source, setSource] = useState("");
  const [saleValue, setSaleValue] = useState("");
  const [saleDate, setSaleDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [saleCosts, setSaleCosts] = useState("");
  const [accountId, setAccountId] = useState("");
  const [isPending, startTransition] = useTransition();

  const purchase = decimalToCents(asset.purchaseValue);
  const current = decimalToCents(asset.currentValue);
  const diff = current - purchase;
  const diffPct =
    purchase > 0n ? Number((diff * 10000n) / purchase) / 100 : null;
  const isActive = asset.status === "active";

  function submitValuation() {
    const parsed = parseMoneyInput(value);
    if (!parsed) {
      toast.error("Informe um valor válido.");
      return;
    }
    startTransition(async () => {
      const result = await addValuation({
        assetId: asset.id,
        eventType,
        value: parsed,
        eventDate,
        source,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Avaliação registrada.");
        setValOpen(false);
        setValue("");
        setSource("");
      }
    });
  }

  function submitSale() {
    const parsed = parseMoneyInput(saleValue);
    if (!parsed) {
      toast.error("Informe o valor da venda.");
      return;
    }
    startTransition(async () => {
      const result = await sellAssetAction({
        assetId: asset.id,
        saleValue: parsed,
        saleDate,
        accountId,
        saleCosts: saleCosts ? (parseMoneyInput(saleCosts) ?? "") : "",
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Venda registrada — o valor entrou no caixa.");
        setSellOpen(false);
      }
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 truncate font-medium">
            {asset.name}
            {asset.ownershipPercent !== "100.00" && (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {Number(asset.ownershipPercent).toLocaleString("pt-BR")}%
              </span>
            )}
          </span>
          <Badge variant="outline">{ASSET_TYPE_LABELS[asset.type]}</Badge>
          {!isActive && (
            <Badge variant="secondary">
              {ASSET_STATUS_LABELS[asset.status]}
            </Badge>
          )}
        </div>

        <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs tabular-nums">
          <span className="text-foreground text-base font-semibold">
            {formatBRL(asset.currentValue)}
          </span>
          <span>Compra: {formatBRL(asset.purchaseValue)}</span>
          {diffPct !== null && diff !== 0n && (
            <span className={diff > 0n ? "text-primary" : "text-destructive"}>
              {diff > 0n ? "+" : "−"}
              {formatCentsBRL(diff < 0n ? -diff : diff)} (
              {diffPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)
            </span>
          )}
          {asset.valuationDate && (
            <span>
              Avaliado em {formatDateBR(asset.valuationDate)}
              {asset.valuationSource ? ` (${asset.valuationSource})` : ""}
            </span>
          )}
          {asset.status === "sold" && asset.saleValue && (
            <span>
              Vendido por {formatBRL(asset.saleValue)} em{" "}
              {formatDateBR(asset.saleDate)}
            </span>
          )}
        </div>

        {isActive && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setValOpen(true)}
            >
              <TrendingUp />
              Nova avaliação
            </Button>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSellOpen(true)}
              >
                <HandCoins />
                Registrar venda
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={valOpen} onOpenChange={setValOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova avaliação de “{asset.name}”</DialogTitle>
            <DialogDescription>
              Atualiza o valor atual e mantém todo o histórico — o valor de
              compra nunca muda.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Tipo de evento</Label>
              <Select
                value={eventType}
                onValueChange={(v) => setEventType(v as ValuationEvent)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(VALUATION_EVENT_LABELS) as ValuationEvent[]
                  ).map((key) => (
                    <SelectItem key={key} value={key}>
                      {VALUATION_EVENT_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`val-value-${asset.id}`}>
                Novo valor total (R$)
              </Label>
              <Input
                id={`val-value-${asset.id}`}
                inputMode="decimal"
                placeholder="0,00"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`val-date-${asset.id}`}>Data</Label>
              <Input
                id={`val-date-${asset.id}`}
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`val-source-${asset.id}`}>Fonte (opcional)</Label>
              <Input
                id={`val-source-${asset.id}`}
                placeholder="Ex.: corretor, tabela FIPE…"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setValOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitValuation} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Registrar avaliação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vender “{asset.name}”</DialogTitle>
            <DialogDescription>
              O valor líquido (venda − custos) entra na conta escolhida como
              transação, o ativo sai do patrimônio e o histórico é preservado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`sale-value-${asset.id}`}>
                Valor da venda (R$)
              </Label>
              <Input
                id={`sale-value-${asset.id}`}
                inputMode="decimal"
                placeholder="0,00"
                value={saleValue}
                onChange={(event) => setSaleValue(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`sale-costs-${asset.id}`}>
                Custos da venda (R$, opcional)
              </Label>
              <Input
                id={`sale-costs-${asset.id}`}
                inputMode="decimal"
                placeholder="0,00"
                value={saleCosts}
                onChange={(event) => setSaleCosts(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`sale-date-${asset.id}`}>Data</Label>
              <Input
                id={`sale-date-${asset.id}`}
                type="date"
                value={saleDate}
                onChange={(event) => setSaleDate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Conta de destino</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSellOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitSale} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Confirmar venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
