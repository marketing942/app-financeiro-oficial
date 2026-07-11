import {
  Bot,
  Briefcase,
  Building,
  HandCoins,
  Landmark,
  LayoutDashboard,
  PieChart,
  PiggyBank,
  Settings,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Receitas", href: "/receitas", icon: TrendingUp },
  { title: "Despesas", href: "/despesas", icon: TrendingDown },
  { title: "Investimentos", href: "/investimentos", icon: PiggyBank },
  { title: "Financiamentos", href: "/financiamentos", icon: HandCoins },
  { title: "Dívidas", href: "/dividas", icon: Landmark },
  { title: "Patrimônio", href: "/patrimonio", icon: Building },
  { title: "Negócios e Projetos", href: "/projetos", icon: Briefcase },
  { title: "Planejamento", href: "/planejamento", icon: Target },
  { title: "Nylo", href: "/nylo", icon: Bot },
  { title: "Relatórios", href: "/relatorios", icon: PieChart },
];

export const SECONDARY_NAV_ITEMS: NavItem[] = [
  { title: "Membros e acessos", href: "/membros", icon: Users },
  { title: "Configurações", href: "/configuracoes", icon: Settings },
];

// Navegação inferior no celular: 4 atalhos + "Mais".
export const MOBILE_NAV_HREFS = [
  "/",
  "/receitas",
  "/despesas",
  "/planejamento",
];

export const ALL_NAV_ITEMS = [...NAV_ITEMS, ...SECONDARY_NAV_ITEMS];
