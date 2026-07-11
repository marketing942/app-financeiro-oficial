# DOMÍNIO FINANCEIRO — Regras Permanentes do Projeto

Sistema web de controle financeiro pessoal e patrimonial baseado no método
**Domínio Financeiro**, com assistente de IA chamada **Nylo**.

Este arquivo contém regras permanentes. Elas valem para toda e qualquer
alteração de código neste repositório.

## Stack (não substituir sem decisão documentada)

- **Next.js** (versão estável atual, App Router) + **React** + **TypeScript estrito**
- **Tailwind CSS** + **shadcn/ui** + **Lucide React** (ícones) + **Recharts** (gráficos)
- **Supabase**: Auth (e-mail/senha), PostgreSQL, Row Level Security
- **React Hook Form** + **Zod** (validação) + **date-fns** (datas)
- **OpenAI SDK oficial** (Responses API, Structured Outputs, function calling, streaming)
- **Vitest** (unitários) + **Playwright** (E2E) + **ESLint** + **Prettier**
- Deploy: **Vercel**

## Regras invioláveis

1. **Dinheiro nunca em `float`.** No banco: `numeric(14,2)`. No TypeScript:
   valores monetários trafegam como string ou inteiro em centavos; cálculos
   críticos acontecem no PostgreSQL (views/funções), nunca duplicados no frontend.
2. **RLS em todas as tabelas privadas.** Nenhuma tabela financeira sem policy.
   Isolamento por `workspace_id`. Autorização sempre validada no servidor.
3. **`service_role_key` e `OPENAI_API_KEY` jamais no cliente.** Variáveis
   secretas apenas no servidor (sem prefixo `NEXT_PUBLIC_`).
4. **Fonte única de verdade financeira**: a tabela `transactions`. Nenhuma
   página soma valores por conta própria — tudo vem de views/funções SQL.
5. **Planejado e realizado coexistem.** Registrar o realizado nunca sobrescreve
   o planejado.
6. **Transferências não são receita nem despesa** e não alteram patrimônio líquido.
7. **Aportes não são despesa de consumo.** Financiamentos com finalidade de
   investimento/projeto **não** entram nos 20% da regra 50/20/30 — somente
   `consumo próprio`.
8. **Regra do 100%**: exatamente 100% = "limite atingido"; somente **acima**
   de 100% = "ultrapassado". Exatamente 50% / 20% = dentro do limite;
   exatamente 30% = mínimo cumprido. Vale para cards, gráficos, alertas,
   relatórios, Dashboard e Nylo.
9. **Exclusão lógica** (`deleted_at`) para dados financeiros; históricos e
   snapshots nunca são apagados em cascata.
10. **Nylo nunca executa ações financeiras diretamente.** Escrita apenas via
    rascunho estruturado + confirmação explícita do usuário + validação no
    servidor. Nylo não acessa segredos, não inventa dados nem cotações, não
    promete rentabilidade.
11. **Sem mocks em produção.** Sem autenticação simulada, sem localStorage
    como banco, sem funções falsas em fluxos declarados como concluídos.
12. **Auditoria** (`audit_logs`) para toda operação sensível (CRUD financeiro,
    convites, permissões, chamadas de escrita da Nylo).
13. **Server Components por padrão.** Client Components apenas para estado
    interativo, formulários dinâmicos, gráficos, modais, chat em streaming e
    APIs do navegador.
14. **Idioma da interface: português (Brasil).** Moeda BRL, datas `dd/MM/yyyy`,
    timezone padrão `America/Recife`. Código (identificadores, tabelas,
    commits) em inglês.

## Comandos de validação (obrigatórios ao fim de cada fase)

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test        # Vitest
npm run build       # next build
npm run test:e2e    # Playwright (fluxos críticos)
```

Nenhuma fase é considerada concluída com qualquer um desses comandos falhando.
Registrar em `docs/IMPLEMENTATION_PLAN.md` o que foi concluído e as pendências
reais — nunca esconder funcionalidades incompletas.

## Estrutura de pastas (alvo)

```
src/
  app/                  # rotas (App Router)
    (public)/           # login, cadastro, recuperação, convite
    (app)/              # rotas autenticadas
    api/                # route handlers (Nylo, webhooks, cron)
  components/           # UI compartilhada (shadcn/ui em components/ui)
  lib/
    supabase/           # clientes (server, browser, middleware)
    ai/                 # Nylo: agente, ferramentas, schemas
    finance/            # tipos e helpers (formatação; sem cálculo crítico)
    validation/         # schemas Zod
  server/               # data-access layer (queries, mutations, autorização)
supabase/
  migrations/           # migrations SQL versionadas
  seed.sql              # categorias padrão etc.
docs/                   # especificações (fonte de verdade do produto)
tests/                  # e2e (Playwright); unitários junto ao código (*.test.ts)
```

## Documentação de referência (ler antes de mexer na área correspondente)

- `docs/PROJECT_SPEC.md` — especificação funcional consolidada
- `docs/DATABASE.md` — entidades, relacionamentos, índices, constraints, RLS
- `docs/CALCULATIONS.md` — todas as fórmulas financeiras (fonte de verdade)
- `docs/AI_NYLO.md` — arquitetura, ferramentas, segurança e limites da Nylo
- `docs/SECURITY.md` — autenticação, autorização, proteção de dados, auditoria
- `docs/IMPLEMENTATION_PLAN.md` — fases, dependências, critérios de aceite, status
- `docs/DEPLOYMENT.md` — Supabase, Vercel, variáveis de ambiente

## Convenções

- Migrations: `supabase/migrations/NNNN_descricao.sql`, imutáveis após merge.
- Nomes de tabelas/colunas em `snake_case` inglês; enums PostgreSQL para status.
- Todo formulário: schema Zod compartilhado entre cliente e servidor; a
  validação do servidor é a que vale.
- Commits: mensagem imperativa curta em inglês, corpo explicando o porquê.
- Nunca criar hierarquia de categorias além de categoria → subcategoria.
