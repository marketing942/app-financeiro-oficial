# Domínio Financeiro

Sistema web de controle financeiro pessoal e patrimonial baseado no método
**Domínio Financeiro**, com a assistente de IA **Nylo**.

Stack: Next.js (App Router) · TypeScript estrito · Tailwind CSS · shadcn/ui ·
Supabase (Auth + PostgreSQL + RLS) · OpenAI · Vercel.

## Documentação

- [`CLAUDE.md`](./CLAUDE.md) — regras permanentes do projeto
- [`docs/PROJECT_SPEC.md`](./docs/PROJECT_SPEC.md) — especificação funcional
- [`docs/DATABASE.md`](./docs/DATABASE.md) — modelo de dados e RLS
- [`docs/CALCULATIONS.md`](./docs/CALCULATIONS.md) — fórmulas financeiras
- [`docs/AI_NYLO.md`](./docs/AI_NYLO.md) — arquitetura da Nylo
- [`docs/SECURITY.md`](./docs/SECURITY.md) — segurança
- [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) — fases e status
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — Supabase + Vercel

## Desenvolvimento

```bash
cp .env.example .env.local   # preencher com o projeto Supabase
npm install
npm run dev
```

## Validação

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test        # Vitest (unitários)
npm run test:rls    # RLS e regras financeiras contra PostgreSQL real
npm run test:e2e    # Playwright (fluxos críticos)
npm run build       # next build
```

`npm run test:rls` sobe um cluster PostgreSQL local com um shim idêntico ao
schema `auth` do Supabase, aplica todas as migrations e executa a suíte de
segurança/cálculo (isolamento por workspace, revogação imediata, regra do
100%, 50/20/30, anti-dupla-contabilização, cron de manutenção etc.).

## Rotinas agendadas (produção)

`vercel.json` agenda dois crons autenticados por `CRON_SECRET`:

- `/api/cron/daily` — marca atrasos, estende recorrências, recomputa
  alertas de todos os espaços e expira conversas da Nylo;
- `/api/cron/monthly` — snapshot patrimonial mensal de todos os espaços.
