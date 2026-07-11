# DOMÍNIO FINANCEIRO — Segurança

## 1. Autenticação (Supabase Auth)

- E-mail e senha; confirmação de e-mail **configurável** (ativada por padrão
  em produção via painel do Supabase); recuperação e redefinição de senha
  pelos fluxos nativos (`resetPasswordForEmail` + rota `/redefinir-senha`).
- Sessões via cookies httpOnly gerenciados por `@supabase/ssr`; refresh no
  middleware; nada de tokens em localStorage.
- Proteção de rotas: middleware redireciona não autenticados de `(app)` para
  `/login`; verificação repetida nos Server Components/route handlers
  (`supabase.auth.getUser()` — nunca confiar só no middleware).
- Sem compartilhamento de senha por design: cada assistente tem conta própria
  (convites, nunca credenciais).

## 2. Autorização

Modelo em camadas — **a camada que vale é o banco**:

1. **RLS (obrigatória)**: todas as tabelas privadas com policies por
   `workspace_id` + membership ativa (ver `DATABASE.md` §13). Nenhuma tabela
   financeira exposta sem RLS. Checagem por query ⇒ **revogação imediata**.
2. **Data-access layer (`src/server/`)**: toda mutação passa por função que
   revalida sessão, membership, papel e permissão antes de tocar o banco;
   `workspace_id` derivado da sessão/rota validada, nunca do body.
3. **UI**: esconde ações não permitidas (conveniência, nunca segurança).

Proteções específicas:
- **Acesso horizontal**: impossível por RLS (usuário A não lê workspace de B
  mesmo forjando IDs) — coberto por testes.
- **Adulteração de `workspace_id`**: `with check` nas policies + trigger que
  imutabiliza a coluna + derivação no servidor (defesa tripla).
- **Papéis**: ações exclusivas do owner (convites, revogação, permissões,
  configurações críticas, exclusão do espaço, auditoria) validadas por
  `app.is_owner()` nas policies e no data-access layer.
- **Permissões granulares**: `app.has_permission()` combina defaults do papel
  (`role_permissions`) + overrides (`workspace_members.permissions`).

## 3. Validação de entrada

- Zod em todo formulário e route handler; o schema do servidor é o que vale.
- Valores monetários: string decimal validada (regex + parse), nunca float.
- Uploads (documentos de projeto): tipo/tamanho validados; Supabase Storage
  com policies por workspace.
- Mensagens de erro genéricas ao usuário (sem stack, sem SQL, sem detalhes
  internos); detalhes só em logs do servidor.

## 4. Segredos

- `SUPABASE_SERVICE_ROLE_KEY`: somente em rotinas administrativas do servidor
  (cron, aceite de convite se necessário) — **jamais** no cliente, jamais com
  prefixo `NEXT_PUBLIC_`.
- `OPENAI_API_KEY`, chave de criptografia e demais segredos: só no servidor.
- `.env.example` documenta tudo sem valores reais; `.env*` no `.gitignore`.
- Assistentes nunca visualizam chaves/segredos (não há superfície de UI).

## 5. Dados sensíveis de pagamento

- Nunca armazenar: senha, token, CVV, número completo de cartão (sem colunas;
  Zod rejeita padrões de PAN/CVV em campos livres).
- Listagens usam view mascarada; dados completos apenas após ação explícita
  do usuário com permissão `view_full_payment_data` (owner sempre), com
  registro em auditoria.
- Nada de dados sensíveis no prompt da Nylo (mascaramento antes do envio).

## 6. Rate limiting e antiabuso

- Nylo: limites por usuário e por workspace (mensagens/dia, tokens/mês) via
  `ai_usage_logs`, configuráveis por env e `workspace_settings`.
- Mutação sensível (login, convite, aceite): limitada por janela
  (contagem no banco por usuário/IP) + proteção nativa do Supabase Auth.
- Convites: token de 32 bytes aleatórios, armazenado só como hash sha256,
  expiração padrão 7 dias, single-use.

## 7. Auditoria

- `audit_logs` append-only (sem UPDATE/DELETE nem para owner; auditoria não
  pode ser desabilitada por ninguém).
- Registra: criação/edição/exclusão/restauração de registros financeiros,
  pagamentos, recebimentos, aportes, eventos de patrimônio/dívida/projeto,
  convites, revogações, mudanças de permissão, visualização de dados de
  pagamento completos e chamadas de escrita relevantes da Nylo.
- Campos: workspace, usuário, ação, entidade, id, data, resumo, metadata.
- Leitura: apenas owner do workspace.

## 8. Exclusões e reversibilidade

- Toda exclusão exige confirmação na UI.
- Dados financeiros: exclusão lógica (`deleted_at`); históricos, snapshots e
  auditoria nunca são apagados em cascata.
- Exclusão do workspace: apenas owner, com confirmação reforçada (digitar o
  nome), executada como soft delete com janela de arrependimento.

## 9. Testes de segurança obrigatórios (Vitest + SQL/Playwright)

1. Owner acessa seu espaço;
2. Assistente autorizado acessa o espaço;
3. Assistente revogado perde acesso **imediatamente** (leitura e escrita);
4. Usuário não acessa outro espaço (SELECT/INSERT/UPDATE/DELETE negados);
5. Assistente não executa ações exclusivas do owner;
6. Alterar `workspace_id` manualmente não permite invasão;
7. Nylo não consulta dados de outro espaço;
8. Conversas da Nylo isoladas por usuário;
9. Ferramentas da Nylo respeitam permissões;
10. Dados de pagamento não expostos indevidamente (mascaramento + permissão).

Executados contra Postgres real (Supabase local/CI) com múltiplos usuários
de teste — não contra mocks.
