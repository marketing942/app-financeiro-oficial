# DOMÍNIO FINANCEIRO — Plano de Implementação

13 fases sequenciais. Cada fase só é concluída com `lint`, `typecheck`,
`test` e `build` passando, status registrado aqui (✅/⚠️ com pendências
reais — nunca esconder incompletudes). **Execução contínua autorizada pelo
proprietário em 2026-07-12: as fases seguem uma a uma, com aviso de
conclusão ao fim de cada uma, sem novo pedido de autorização.**

Status geral: 🟢 Fases 1–9 concluídas — Fase 10 em andamento.

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

| fase                         | status     | concluído em | pendências reais                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planejamento                 | ✅         | 2026-07-11   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1 — Fundação                 | ✅         | 2026-07-11   | (a) E2E de fluxo completo de autenticação (cadastro→confirmação→login, redefinição real) exigem projeto Supabase configurado — cobertos por smoke tests agora e por suíte completa nas Fases 2/13; (b) tema persiste via next-themes/localStorage — persistência em `user_preferences` entra na Fase 2; (c) e-mails do Supabase ainda com templates padrão (traduzir no setup do projeto, ver DEPLOYMENT.md).                                                                                                                                                                                                                                                                                                                                      |
| 2 — Espaços e acessos        | ✅         | 2026-07-12   | (a) Convite entregue por link copiável gerado pelo owner (token exibido uma única vez; hash sha256 no banco) — envio automático por e-mail fica para quando um provedor de e-mail for configurado (DEPLOYMENT.md); (b) testes RLS (12 casos, itens 1–6 de SECURITY.md §9) rodam contra PostgreSQL 16 real via `npm run test:rls` com shim do schema auth idêntico ao Supabase — reexecutar contra Supabase local no CI quando disponível; (c) tema segue no dispositivo (next-themes); espelhar em `user_preferences.theme` quando houver ganho real; (d) preferências avançadas do espaço (início do mês, tolerância, categorias essenciais) têm colunas prontas e UI nas fases dos módulos que as usam.                                          |
| 3 — Categorias e contas      | ✅         | 2026-07-12   | (a) Saldo calculado das contas (view `account_balances` sobre transações) chega na Fase 4 — a página de Contas exibe hoje o saldo inicial, rotulado como tal; (b) rota `/contas` e `/categorias` adicionadas ao menu secundário (a lista de rotas da especificação não previa página própria de contas — decisão documentada); (c) gestão de contas é exclusiva do proprietário (contas não fazem parte do catálogo de 10 permissões concedíveis da especificação); (d) categorias de receita não têm padrão semeado — o usuário cria as suas (16 padrões da especificação são de despesa); (e) UI de payment_methods (cartões salvos) entra na Fase 4 junto com dados de pagamento.                                                               |
| 4 — Transações (núcleo)      | ✅         | 2026-07-12   | (a) Edição de séries com escopo "só esta / esta e as próximas / toda a série" tem a base pronta no banco (função idempotente + chave única preserva realizadas); a UI de edição de série entra junto com Financiamentos (Fase 6), onde parcelas são o caso dominante; (b) recorrência "personalizada" (intervalo em dias) suportada no banco, ainda sem UI; (c) job diário de atrasos (`mark_overdue_transactions`) pronto e restrito a service_role — agendamento via cron da Vercel na Fase 13 (DEPLOYMENT.md); (d) detalhamento de descontos REALIZADOS de receita suportado pela action, UI usa valor líquido no recebimento; (e) recorrências geram 12 meses à frente na criação — extensão automática do horizonte entra no cron diário.     |
| 5 — Investimentos            | ✅         | 2026-07-12   | (a) Rentabilidade automática não é calculada — o saldo cresce por aportes; atualização de valor de mercado entra com avaliações de ativos (Fase 7, `asset_valuations`); (b) resgates saem como transferência/ajuste manual por enquanto — natureza dedicada de resgate pode ser adicionada se houver demanda real; (c) metas de aporte completas (ritmo/marcos) entram no motor central da Fase 8 — hoje há meta de valor com barra de progresso.                                                                                                                                                                                                                                                                                                  |
| 6 — Financiamentos e Dívidas | ✅         | 2026-07-12   | (a) Amortização simples: saldo = original − pago (juros embutidos no valor total/parcelas — documentado); tabela Price/SAC com separação juros×principal tem colunas prontas (`interest_type`, `principal/interest_amount` em liability_payments) e cálculo pode ser adicionado sem migração; (b) simulação de antecipação usa parcela fixa + extra (sem recálculo de juros) — coerente com (a); (c) metas de quitação completas (valor alvo/data/ritmo) entram no motor central da Fase 8; (d) vínculo de dívida a bem (`asset_id`) ativa na Fase 7 com a tabela assets.                                                                                                                                                                          |
| 7 — Patrimônio               | ✅         | 2026-07-12   | (a) Snapshot mensal automático (`create_monthly_snapshots`, service_role) pronto no banco — agendamento via cron da Vercel na Fase 13 (DEPLOYMENT.md); botão manual disponível na página; (b) gráfico de evolução patrimonial (Recharts) entra no Dashboard (Fase 11) — a página exibe a série em tabela; (c) cotação automática de bens (FIPE/imóveis) fora do escopo: avaliações são manuais com fonte registrada, por decisão da especificação (Nylo não inventa cotações); (d) `project_id` em assets ativa na Fase 9 com business_projects.                                                                                                                                                                                                   |
| 8 — Metas e Planejamento     | ✅         | 2026-07-12   | (a) Meta tipo `project` fica com valor 0 até a Fase 9 ligar `project_financials` — o tipo existe no enum e o formulário o oculta até lá; (b) coluna `status` de metas não é armazenada: sempre derivada por `goal_progress` (fonte única, sem risco de divergência) — desvio documentado de DATABASE.md; (c) alertas de meta aparecem como status/badges na página; alertas persistentes (`alerts` + `recompute_alerts`, 22 regras) e `category_limits` entram na Fase 11 como especificado; (d) definição precisa de "meses" (índice de calendário) registrada em CALCULATIONS.md §7; (e) edição completa de meta (nome/prazo/alvo) pela UI fica para quando houver demanda — hoje há criar, arquivar e atualizar progresso manual (só `custom`). |
| 9 — Negócios e Projetos      | ✅         | 2026-07-12   | (a) Upload de documentos/fotos depende do bucket do Supabase Storage configurado no deploy — tabela `project_documents` pronta com RLS, UI de upload entra com o Storage (DEPLOYMENT.md); (b) `project_members` criada com RLS; gestão fina por projeto (responsáveis por etapa) fica para demanda real — hoje o acesso é o do workspace; (c) vínculo de ativos a projetos usa `assets.project_id` (a associativa `project_assets` foi descartada — decisão em DATABASE.md §8); (d) venda de ativo de projeto via `sell_asset` entra no caixa como `asset_sale` pessoal — receita de venda DO PROJETO deve ser lançada como receita do projeto (documentado na UI); (e) meta tipo `project` ligada ao resultado líquido via `project_financials`.  |
| 10–13                        | ⏳ na fila |              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
