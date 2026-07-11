import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

const ERROR_MESSAGES: Record<string, string> = {
  "link-invalido":
    "O link utilizado é inválido ou expirou. Entre ou solicite um novo link.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  return <LoginForm initialError={erro ? ERROR_MESSAGES[erro] : undefined} />;
}
