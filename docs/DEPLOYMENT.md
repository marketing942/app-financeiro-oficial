# DOMÍNIO FINANCEIRO — Deploy (Supabase + Vercel)

## 1. Variáveis de ambiente

`.env.example` (criado na Fase 1) documenta todas — sem valores reais:

| variável                        | escopo               | descrição                                     |
| ------------------------------- | -------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | cliente+servidor     | URL do projeto Supabase                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cliente+servidor     | chave pública (RLS decide o acesso)           |
| `SUPABASE_SERVICE_ROLE_KEY`     | **somente servidor** | rotinas administrativas/cron; nunca no bundle |
| `NEXT_PUBLIC_APP_URL`           | cliente+servidor     | URL canônica do app (links de convite/e-mail) |
| `ANTHROPIC_API_KEY`             | **somente servidor** | chave da Anthropic/Claude (`sk-ant-...`)      |
| `ANTHROPIC_MODEL`               | servidor             | modelo da Nylo (padrão `claude-opus-4-8`)     |
| `NYLO_DAILY_MESSAGE_LIMIT`      | servidor             | teto de mensagens/usuário/dia (padrão 100)    |
| `ANTHROPIC_INPUT_COST_PER_MTOK` | servidor             | custo USD/1M tokens de entrada (opcional)     |
| `ANTHROPIC_OUTPUT_COST_PER_MTOK`| servidor             | custo USD/1M tokens de saída (opcional)       |
| `APP_ENCRYPTION_KEY`            | **somente servidor** | criptografia de campos sensíveis              |
| `MARKET_DATA_PROVIDER`          | servidor             | provedor de cotações (vazio = desativado)     |
| `CRON_SECRET`                   | servidor             | autenticação dos endpoints de cron            |

Regra: segredos jamais com prefixo `NEXT_PUBLIC_`; jamais commitados.

Retenção de conversas e teto mensal de mensagens da Nylo são configurações
POR WORKSPACE no banco (`workspace_settings.nylo_retention_days` /
`nylo_monthly_message_limit`), não variáveis de ambiente.

## 2. Supabase

1. Criar projeto (região `sa-east-1`).
2. **Auth**: habilitar e-mail/senha; confirmação de e-mail ON em produção;
   Site URL = `NEXT_PUBLIC_APP_URL`; Redirect URLs:
   `https://<app>/auth/callback`, `https://<app>/redefinir-senha`,
   `http://localhost:3000/**` (dev). Templates de e-mail em pt-BR
   (confirmação, recuperação, convite).
3. **Migrations**: aplicar as 13 (`0001`–`0013`) na ordem — via
   `supabase db push`/`supabase migration up`, ou colando o SQL no SQL
   Editor. Imutáveis após merge.
4. **Seeds** (sem `seed.sql` separado): categorias padrão, `role_permissions`
   e presets de custo de projeto são semeados automaticamente pelas próprias
   migrations — categorias por trigger no cadastro (`handle_new_user` →
   `handle_new_workspace`), presets por trigger na criação do projeto.
5. **Storage** (opcional, só para upload de documentos de projeto): bucket
   `project-documents` privado com policies por workspace.
6. Desenvolvimento local: `supabase start` (Docker) + `supabase db reset`.
   Testes de RLS: `npm run test:rls` (sobe um PostgreSQL local próprio).

## 3. Vercel

1. Importar o repositório; framework Next.js (detecção automática).
2. Configurar todas as variáveis de ambiente (Production/Preview separados —
   ideal: projeto Supabase de staging para Previews).
3. **Cron jobs** (`vercel.json`), autenticados por `CRON_SECRET`
   (a Vercel envia `Authorization: Bearer $CRON_SECRET`):
   - `/api/cron/daily` (06:00 UTC = 03:00 em Recife) → RPC
     `run_daily_maintenance()`: marca atrasos, estende o horizonte das
     recorrências (+12 meses), recomputa alertas de todos os workspaces
     (impersonando o dono de cada um) e expira conversas da Nylo;
   - `/api/cron/monthly` (dia 1, 06:30 UTC) → RPC
     `create_monthly_snapshots()`: snapshot patrimonial de todos os
     workspaces.
4. Build: `next build` (inclui typecheck); lint e testes no CI antes do
   deploy.

## 4. Scripts (`package.json`)

```
dev, build, start, lint, typecheck, test, test:watch, test:rls, test:e2e,
format, format:check
```

## 5. Checklist de go-live

- [ ] 13 migrations aplicadas na ordem (seeds automáticos, sem seed.sql)
- [ ] RLS ativa em todas as tabelas (query de verificação no CI)
- [ ] Confirmação de e-mail ON; URLs de redirect corretas
- [ ] Templates de e-mail em pt-BR revisados
- [ ] Variáveis configuradas na Vercel (nenhum segredo com `NEXT_PUBLIC_`)
- [ ] Crons ativos e autenticados
- [ ] `lint`, `typecheck`, `test`, `test:rls`, `test:e2e`, `build` verdes no CI
- [ ] Testes de segurança (SECURITY.md §9) verdes contra staging
- [ ] `ANTHROPIC_API_KEY` configurada e Nylo validada ponta-a-ponta em staging
- [ ] Rate limits da Nylo configurados
- [ ] Domínio + HTTPS + Site URL atualizada
- [ ] Backup automático do Supabase habilitado
