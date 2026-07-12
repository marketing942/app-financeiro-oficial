# DOMÍNIO FINANCEIRO — Plano de Implementação

13 fases sequenciais. Cada fase só é concluída com `lint`, `typecheck`,
`test` e `build` passando, status registrado aqui (✅/⚠️ com pendências
reais — nunca esconder incompletudes). **Cada fase aguarda autorização do
proprietário do projeto antes de iniciar.**

Status geral: 🟢 Fases 1–2 concluídas — Fase 3 em andamento.

---

## Fase 1 — Fundação

**Depende de:** — (planejamento aprovado)

Escopo: scaffold Next.js (App Router, TS estrito) + Tailwind + shadcn/ui +
Lucide + tema claro/escuro persistente (tokens da identidade visual);
ESLint/Prettier/Vitest/Playwright configurados; estrutura de pastas do
CLAUDE.md; projeto Supabase + clientes (`server`, `browser`, middleware);
Auth completo (cadastro, login, confirmação de e-mail, recuperação,
redefinição, logout); proteção de rotas; layout base responsivo (menu
lateral desktop, navegação inferior mobile) com páginas placeholder
explícitas ("em construção" — sem dados falsos).

Aceite: usuário cria conta, confirma e-mail, entra, recupera senha, navega
pelo shell autenticado nos 3 tamanhos de tela, alterna tema com persistência;
rotas privadas bloqueadas sem sessão; 4 comandos de validação verdes.

## Fase 2 — Espaços e acessos

**Depende de:** 1

Escopo: migrations de profiles, workspaces, workspace_members,
workspace_invitations, role_permissions, user_preferences,
workspace_settings, audit_logs; funções `app.is_member/is_owner/
has_permission`; RLS completa; `bootstrap_workspace` (perfil → workspace →
owner → categorias padrão → configurações → preferências → conta opcional →
onboarding); fluxo de convite (token hash, validade, aceite com/sem conta,
estados) e revogação imediata; página Membros; auditoria ativa.

Aceite: os 10 testes de segurança de `SECURITY.md` §9 (itens 1–6) passando
contra Postgres real; convite ponta-a-ponta; revogação bloqueia na hora.

## Fase 3 — Categorias e contas

**Depende de:** 2

Escopo: financial_accounts (CRUD, arquivar, cores/ícones), categories/
subcategories (16 padrão via seed, personalizadas, reordenação, arquivamento
sem apagar lançamentos), payment_methods; view `account_balances`.

Aceite: CRUD completo com RLS; arquivar categoria preserva vínculos; seeds
idempotentes.

## Fase 4 — Transações (núcleo)

**Depende de:** 3

Escopo: transactions + transaction_series + transaction_installments +
payment_instructions (mascaramento + cópia Pix/boleto/dados); áreas Receitas
(4 classes, bruto/descontos/líquido) e Despesas (hierarquia visual, ações:
pagar, parcial, adiar, sem demanda, duplicar, excluir c/ confirmação);
recorrências e parcelamentos (materialização idempotente, edição só
esta/próximas/série, antecipação, cancelamento futuro); status + job diário
de atrasos; views `monthly_cashflow` e `income_statement`.

Aceite: testes unitários de receita líquida, parcelas (soma = total),
recorrência, parcial, "sem demanda", proteção de dados de pagamento;
planejado nunca sobrescrito.

## Fase 5 — Investimentos

**Depende de:** 4

Escopo: investments + investment_contributions (aporte = transação
sincronizada 1:1); grupos padrão; reserva de emergência (meta manual ou
calculada); metas de aporte básicas.

Aceite: aporte reduz conta, aumenta investimento, não conta como despesa;
reserva calcula alvo/percentual/recomendação; sem dupla contabilização.

## Fase 6 — Financiamentos e Dívidas

**Depende de:** 4

Escopo: liabilities + liability_payments; finalidade obrigatória
(`purpose_classification`); página Financiamentos (consumo) e página Dívidas;
pagamento atualiza saldo/pago/parcelas/passivos; metas de quitação +
simulação de antecipação.

Aceite: pagamento de dívida não altera valor do bem; só consumo próprio
entra nos 20%; progresso e vencimentos corretos.

## Fase 7 — Patrimônio

**Depende de:** 6

Escopo: assets + asset_valuations + net_worth_snapshots; eventos; venda com
preservação de histórico; `net_worth_current`; snapshot mensal (cron) +
manual; página Patrimônio com evolução.

Aceite: bruto/passivos/líquido corretos com % de propriedade e dívida
vinculada; snapshots idempotentes; histórico nunca reconstruído do valor
atual.

## Fase 8 — Metas e Planejamento

**Depende de:** 5, 6, 7

Escopo: motor central de metas (12 tipos, ritmo, marcos derivados, direção
maximize/minimize); página Planejamento consolidada com filtros; alertas de
meta.

Aceite: fórmulas de ritmo (CALCULATIONS §7) testadas; sem duplicação por
marco; status corretos nos limites.

## Fase 9 — Negócios e Projetos

**Depende de:** 7

Escopo: business_projects + stages + documents + members + project_assets;
custos/receitas/aportes via transactions com project_id; presets de custo
(construção, veículos); `project_financials`; página com detalhe por projeto.

Aceite: margem/ROI corretos; anti-dupla-contabilização testada; ativos e
dívidas de projeto integram patrimônio/passivos.

## Fase 10 — Nylo

**Depende de:** 8 (lê tudo), 9

Escopo: chat com streaming + histórico + sugestões; 18 ferramentas
(AI_NYLO §3); Structured Outputs para gráficos/relatórios/rascunhos; fluxo
rascunho→confirmação; permissões, isolamento, rate limiting, auditoria,
custos; mercado educativo com disclaimers; configurações da Nylo.

Aceite: testes de AI_NYLO §8; nenhuma escrita sem confirmação; isolamento
comprovado.

## Fase 11 — Dashboard

**Depende de:** 8 (mínimo); enriquecido por 9–10

Escopo: cards de resumo, filtros de período, gráficos (entradas×saídas,
previsto×realizado, evolução, distribuição, rosca 50/20/30), vencimentos,
patrimônio, projetos, metas, alertas (22 regras, `recompute_alerts`),
insights/pergunta rápida da Nylo, botão de privacidade.

Aceite: regra do 100% e igualdades do 50/20/30 respeitadas em todos os
componentes; dashboard consome só agregações do banco.

## Fase 12 — Relatórios

**Depende de:** 11

Escopo: relatórios (mensal, anual, personalizado, por área, 50/20/30,
previsto×realizado); filtros/ordenação; cards+tabela+gráficos; CSV;
impressão; resumo descritivo da Nylo.

Aceite: números batem com o Dashboard (mesmas views); CSV íntegro.

## Fase 13 — Qualidade e entrega

**Depende de:** 12

Escopo: varredura de responsividade e acessibilidade (labels, teclado,
contraste, foco, redução de movimento, resumo textual de gráficos); suíte
E2E completa (17 fluxos de PROJECT_SPEC/testes); revisão de segurança
(10 casos); performance (índices, paginação, carregamento progressivo);
documentação final; checklist de deploy (DEPLOYMENT.md).

Aceite: os 33 critérios de aceite do projeto verificados um a um.

---

## Registro de conclusão

| fase                  | status     | concluído em | pendências reais                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planejamento          | ✅         | 2026-07-11   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1 — Fundação          | ✅         | 2026-07-11   | (a) E2E de fluxo completo de autenticação (cadastro→confirmação→login, redefinição real) exigem projeto Supabase configurado — cobertos por smoke tests agora e por suíte completa nas Fases 2/13; (b) tema persiste via next-themes/localStorage — persistência em `user_preferences` entra na Fase 2; (c) e-mails do Supabase ainda com templates padrão (traduzir no setup do projeto, ver DEPLOYMENT.md).                                                                                                                                                                                                                                                                                             |
| 2 — Espaços e acessos | ✅         | 2026-07-12   | (a) Convite entregue por link copiável gerado pelo owner (token exibido uma única vez; hash sha256 no banco) — envio automático por e-mail fica para quando um provedor de e-mail for configurado (DEPLOYMENT.md); (b) testes RLS (12 casos, itens 1–6 de SECURITY.md §9) rodam contra PostgreSQL 16 real via `npm run test:rls` com shim do schema auth idêntico ao Supabase — reexecutar contra Supabase local no CI quando disponível; (c) tema segue no dispositivo (next-themes); espelhar em `user_preferences.theme` quando houver ganho real; (d) preferências avançadas do espaço (início do mês, tolerância, categorias essenciais) têm colunas prontas e UI nas fases dos módulos que as usam. |
| 3–13                  | ⏳ na fila |              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
