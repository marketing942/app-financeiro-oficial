import type { Metadata } from "next";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "Receitas" };

export default function Page() {
  return <UnderConstruction title="Receitas" phase="Fase 4" />;
}
