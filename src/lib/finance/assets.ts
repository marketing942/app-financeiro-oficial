// Tipos e labels de patrimônio — client-safe.

export type AssetType =
  | "property"
  | "land"
  | "vehicle"
  | "company"
  | "equity_stake"
  | "financial"
  | "equipment"
  | "construction"
  | "capitalizable_project"
  | "other";

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  property: "Imóvel",
  land: "Terreno",
  vehicle: "Veículo",
  company: "Empresa",
  equity_stake: "Participação",
  financial: "Investimento financeiro",
  equipment: "Equipamento",
  construction: "Obra",
  capitalizable_project: "Projeto capitalizável",
  other: "Outros",
};

export type AssetStatus = "active" | "sold" | "written_off" | "archived";

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  active: "Ativo",
  sold: "Vendido",
  written_off: "Baixado",
  archived: "Arquivado",
};

export type Asset = {
  id: string;
  name: string;
  type: AssetType;
  purchaseValue: string;
  purchaseDate: string | null;
  currentValue: string;
  valuationDate: string | null;
  valuationSource: string | null;
  ownershipPercent: string;
  liabilityId: string | null;
  status: AssetStatus;
  saleValue: string | null;
  saleDate: string | null;
  note: string | null;
};

export type NetWorth = {
  grossWorth: string;
  totalLiabilities: string;
  netWorth: string;
  investmentsTotal: string;
  cashTotal: string;
};

export type Snapshot = {
  snapshotDate: string;
  grossWorth: string;
  totalLiabilities: string;
  netWorth: string;
};
