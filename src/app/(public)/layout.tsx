import { Brand } from "@/components/brand";

export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4 sm:p-6">
      <Brand />
      <main className="w-full max-w-sm">{children}</main>
      <p className="text-muted-foreground max-w-sm text-center text-xs">
        Método Domínio Financeiro — planejamento, patrimônio e prosperidade.
      </p>
    </div>
  );
}
