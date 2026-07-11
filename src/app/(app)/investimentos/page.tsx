import type { Metadata } from "next";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "Investimentos" };

export default function Page() {
  return <UnderConstruction title="Investimentos" phase="Fase 5" />;
}
