# DOMÍNIO FINANCEIRO — Deploy (Supabase + Vercel)

## 1. Variáveis de ambiente

`.env.example` (criado na Fase 1) documenta todas — sem valores reais:

| variável                        | escopo               | descrição                                     |
| ------------------------------- | -------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | cliente+servidor     | URL do projeto Supabase                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cliente+servidor     | chave pública (RLS decide o acesso)           |
| `SUPABASE_SERVICE_ROLE_KEY`     | **somente servidor** | rotinas administrativas/cron; nunca no bundle |
| `NEXT_PUBLIC_APP_URL`           | cliente+servidor     | URL canônica do app (links de convite/e-mail) |
| `OPENAI_API_KEY`                | **somente servidor** | chave da OpenAI                               |
| `OPENAI_MODEL`                  | servidor             | modelo da Nylo (configurável)                 |
| `NYLO_DAILY_MESSAGE_LIMIT`      | servidor             | teto de mensagens/usuário/dia                 |
| `NYLO_MONTHLY_TOKEN_LIMIT`      | servidor             | teto de tokens/workspace/mês                  |
| `NYLO_RETENTION_DAYS`           | servidor             | retenção padrão de conversas                  |
| `APP_ENCRYPTION_KEY`            | **somente servidor** | criptografia de campos sensíveis              |
| `MARKET_DATA_PROVIDER`          | servidor             | provedor de cotações (vazio = desativado)     |
| `CRON_SECRET`                   | servidor             | autenticação dos endpoints de cron            |

Regra: segredos jamais com prefixo `NEXT_PUBLIC_`; jamais commitados.

## 2. Supabase

1. Criar projeto (região `sa-east-1`).
2. **Auth**: habilitar e-mail/senha; confirmação de e-mail ON em produção;
   Site URL = `NEXT_PUBLIC_APP_URL`; Redirect URLs:
   `https://<app>/auth/callback`, `https://<app>/redefinir-senha`,
   `http://localhost:3000/**` (dev). Templates de e-mail em pt-BR
   (confirmação, recuperação, convite).
3. **Migrations**: `supabase db push` (CI) ou `supabase migration up`;
   arquivos em `supabase/migrations/` são imutáveis após merge.
4. **Seed**: `supabase/seed.sql` (idempotente) — categorias padrão, grupos,
   role_permissions, presets de custo.
5. **Storage**: bucket `project-documents` privado com policies por
   workspace.
6. Desenvolvimento local: `supabase start` (Docker) + `supabase db reset`
   (aplica migrations + seed). Testes de RLS rodam contra essa instância.

## 3. Vercel

1. Importar o repositório; framework Next.js (detecção automática).
2. Configurar todas as variáveis de ambiente (Production/Preview separados —
   ideal: projeto Supabase de staging para Previews).
3. **Cron jobs** (`vercel.json`), autenticados por `CRON_SECRET`:
   - diário: materializar recorrências, marcar atrasos, recomputar alertas,
     expirar convites e conversas da Nylo;
   - mensal (dia 1): `create_net_worth_snapshot` para todos os workspaces.
4. Build: `next build` (inclui typecheck); lint e testes no CI antes do
   deploy.

## 4. Scripts (`package.json`)

```
dev, build, start, lint, typecheck, test, test:watch, test:e2e,
db:migrate, db:reset, db:seed, db:types (gerar tipos TS do schema)
```

## 5. Checklist de go-live

- [ ] Migrations aplicadas e seed executado
- [ ] RLS ativa em todas as tabelas (query de verificação no CI)
- [ ] Confirmação de e-mail ON; URLs de redirect corretas
- [ ] Templates de e-mail em pt-BR revisados
- [ ] Variáveis configuradas na Vercel (nenhum segredo com `NEXT_PUBLIC_`)
- [ ] Crons ativos e autenticados
- [ ] `lint`, `typecheck`, `test`, `test:e2e`, `build` verdes no CI
- [ ] Testes de segurança (SECURITY.md §9) verdes contra staging
- [ ] Rate limits da Nylo configurados
- [ ] Domínio + HTTPS + Site URL atualizada
- [ ] Backup automático do Supabase habilitado
