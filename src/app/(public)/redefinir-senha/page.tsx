import type { Metadata } from "next";
import { RedefinirForm } from "./redefinir-form";

export const metadata: Metadata = { title: "Redefinir senha" };

export default function RedefinirSenhaPage() {
  return <RedefinirForm />;
}
