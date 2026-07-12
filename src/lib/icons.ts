import {
  Baby,
  BadgeDollarSign,
  Banknote,
  Briefcase,
  Building,
  Car,
  CircleDollarSign,
  CreditCard,
  Gift,
  GraduationCap,
  HandCoins,
  HandHeart,
  HeartHandshake,
  HeartPulse,
  House,
  Landmark,
  MonitorSmartphone,
  PiggyBank,
  Popcorn,
  Receipt,
  Shirt,
  ShoppingCart,
  Tag,
  TrendingUp,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// Ícones disponíveis para categorias e contas. Os nomes são persistidos no
// banco (coluna `icon`) e resolvidos aqui — nunca importar dinamicamente.
export const ICON_MAP: Record<string, LucideIcon> = {
  Baby,
  BadgeDollarSign,
  Banknote,
  Briefcase,
  Building,
  Car,
  CircleDollarSign,
  CreditCard,
  Gift,
  GraduationCap,
  HandCoins,
  HandHeart,
  HeartHandshake,
  HeartPulse,
  House,
  Landmark,
  MonitorSmartphone,
  PiggyBank,
  Popcorn,
  Receipt,
  Shirt,
  ShoppingCart,
  Tag,
  TrendingUp,
  Users,
  UtensilsCrossed,
  Wallet,
};

export const ICON_NAMES = Object.keys(ICON_MAP);

export function getIcon(name: string | null | undefined): LucideIcon {
  return (name && ICON_MAP[name]) || Tag;
}

// Paleta de cores para categorias/contas (persistida como hex).
export const COLOR_PALETTE = [
  "#16a34a",
  "#059669",
  "#0d9488",
  "#0891b2",
  "#0284c7",
  "#2563eb",
  "#7c3aed",
  "#9333ea",
  "#db2777",
  "#e11d48",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#a16207",
  "#64748b",
  "#475569",
] as const;
