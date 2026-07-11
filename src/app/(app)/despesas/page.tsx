import type { Metadata } from "next";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "Despesas" };

export default function Page() {
  return <UnderConstruction title="Despesas" phase="Fase 4" />;
}
