import type { Metadata } from "next";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "Nylo" };

export default function Page() {
  return <UnderConstruction title="Nylo" phase="Fase 10" />;
}
