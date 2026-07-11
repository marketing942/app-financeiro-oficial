# DOMÍNIO FINANCEIRO — Especificação Funcional Consolidada

Versão 1.0 — fase de planejamento. Este documento consolida os requisitos
funcionais. Fórmulas em `docs/CALCULATIONS.md`; banco em `docs/DATABASE.md`;
Nylo em `docs/AI_NYLO.md`; segurança em `docs/SECURITY.md`.

## 1. Visão do produto

Sistema de controle financeiro pessoal e patrimonial inspirado no método
**Domínio Financeiro**. Não é um gerenciador genérico: integra planejamento
(previsto × realizado), receitas brutas/líquidas, despesas, financiamentos de
consumo, aportes, investimentos, dívidas, patrimônio (bruto, passivos,
líquido), metas, projetos/negócios e a assistente de IA **Nylo**.

Princípio central: **cada lançamento alimenta automaticamente o fluxo de
caixa, os relatórios, as metas, os alertas e, quando aplicável, o patrimônio.**

### As 24 perguntas que o sistema responde

Previsto a entrar; efetivamente entrado; receita bruta; receita líquida;
descontos (impostos, previdência, taxas, comissões); previsto a sair;
efetivamente saído; gasto em despesas; comprometido com financiamentos;
investido; destinado a projetos; destinado a dívidas; sobra de caixa;
patrimônio bruto; passivos; patrimônio líquido; evolução patrimonial;
dentro/fora das metas; cumprimento da regra 50/20/30; ritmo das metas;
ações que exigem atenção; pagamentos/aportes/recebimentos próximos;
lucro de projetos e negócios; categorias acima do planejado.

Cada pergunta é respondida por view/função SQL dedicada (ver
`docs/CALCULATIONS.md` §12 — mapa pergunta → fonte de dados), consumida pelo
Dashboard, pelos relatórios e pelas ferramentas da Nylo.

## 2. Multiusuário — Espaços financeiros

- Entidades: usuário, perfil, **workspace** (espaço financeiro), membro,
  convite, papel, permissão.
- Um usuário participa de 1..N workspaces. Todo dado financeiro pertence a um
  workspace (`workspace_id`).
- Na primeira conta: criar perfil → workspace pessoal → membership como
  proprietário → categorias padrão → configurações do workspace → preferências
  do dashboard → conta financeira inicial (opcional) → onboarding simples.

### Papéis

**Proprietário (owner):** acesso total ao workspace — CRUD completo, metas,
categorias, contas, ativos, dívidas, investimentos, projetos, convites,
revogação, permissões, auditoria, exportação, Nylo, exclusão do workspace.

**Assistente (assistant):** por padrão pode visualizar dados autorizados,
criar/editar receitas e despesas, marcar recebido/pago, registrar pagamentos,
aportes e pagamentos de dívida, atualizar patrimônio, cadastrar dados de
pagamento, consultar vencimentos, usar a Nylo, criar rascunhos e observações.
**Não pode**, por padrão: excluir o workspace, transferir propriedade,
convidar/revogar membros, alterar configurações críticas, acessar outro
espaço, ver chaves secretas, alterar cobrança, desabilitar auditoria.

**Permissões adicionais concedíveis pelo proprietário** (flags individuais):
`delete_transactions`, `edit_categories`, `edit_goals`, `edit_assets`,
`edit_investments`, `edit_liabilities`, `edit_projects`, `export_reports`,
`view_full_payment_data`, `use_nylo_advanced`.

Cada assistente tem conta, e-mail, senha e trilha de auditoria próprios.
**Compartilhamento de senha é proibido por design.**

### Convites

Fluxo: proprietário informa e-mail → convite pendente com token seguro
(aleatório, hash no banco) e validade (padrão 7 dias) → link de aceite →
se não tem conta, cria → ao aceitar vira membro com as permissões definidas →
revogação a qualquer momento **bloqueia imediatamente** leitura e escrita
(RLS consulta a membership a cada query; não há cache de autorização em JWT).
Estados: `pending`, `accepted`, `expired`, `revoked`.

## 3. Modelo financeiro central

Fonte única de verdade: tabela **`transactions`**. Naturezas:

`income` (receita), `consumer_expense` (despesa de consumo),
`consumer_financing` (financiamento de consumo), `investment_contribution`
(aporte), `debt_payment` (pagamento de dívida), `transfer` (transferência),
`project_cost`, `project_income`, `adjustment` (ajuste),
`asset_acquisition` (aquisição patrimonial), `asset_sale` (venda patrimonial).

Cada transação carrega (quando aplicável): conta, natureza, finalidade
(`purpose_classification`), descrição, categoria/subcategoria, valores
previsto/realizado, bruto/descontos/líquido, competência, datas
prevista/realizada, status, recorrência, parcela n/N, série, forma e
instruções de pagamento, vínculos (projeto, ativo, dívida, investimento),
observação, criador, último editor, timestamps e `deleted_at`.

Regras:

- **Nunca `float`** — `numeric(14,2)`.
- Transferências: reduzem uma conta, aumentam outra; não são receita nem
  despesa; não alteram patrimônio líquido.
- Nenhuma página soma valores manualmente: agregações via views/funções SQL.

### Planejado × realizado

Toda funcionalidade financeira diferencia planejado, realizado, diferença e
% de cumprimento. Receita: esperado × recebido. Despesa: reservado × pago.
Financiamento: parcela programada × paga. Aporte: desejado × transferido.
Dívida: parcela programada × amortizado. **Registrar o realizado nunca
sobrescreve o planejado.**

### Status

- Receitas: previsto, recebido parcialmente, recebido, vencido, cancelado.
- Despesas: previsto, a pagar, pago parcialmente, pago, atrasado,
  **sem demanda**, cancelado.
- Aportes: previsto, realizado parcialmente, realizado, atrasado, cancelado.
- Dívidas: ativa, em dia, atrasada, renegociada, quitada, cancelada.
- Projetos: planejamento, em andamento, pausado, pronto para venda, vendido,
  concluído, cancelado.

**Sem demanda**: permanece visível; fora do previsto ativo e do realizado;
não gera atraso; não reduz caixa; reativável.

### Recorrências e parcelas

Suporte a: lançamento único, recorrente (semanal, mensal, bimestral,
trimestral, semestral, anual, personalizada), parcelado, valor fixo ou
variável, recebimento/pagamento parcial, antecipação, cancelamento de
parcelas futuras.

Parcelamentos: valor total, nº de parcelas, valor por parcela, primeira data,
datas futuras, parcela atual, status individual. Edição: só esta / esta e as
próximas / toda a série. **Editar série nunca duplica nem altera parcelas já
realizadas.**

### Dados de pagamento

Instruções opcionais por despesa/financiamento/aporte/pagamento: forma de
pagamento (Pix, boleto, transferência, débito, crédito à vista/parcelado,
dinheiro, débito automático, outro), favorecido, chave Pix (tipo + chave),
dados bancários, linha digitável, código de barras, link, referência de
cartão (apenas últimos 4 dígitos), observações.

Regras: copiar Pix/linha digitável/dados bancários com um clique; **mascarado
na listagem**, dados completos só após ação explícita (auditada); alterações
registradas; **nunca** armazenar senha, token, CVV ou número completo de
cartão; **nenhum pagamento é executado automaticamente no MVP**. O usuário
indica: conta de origem, cartão, forma, chave/boleto/conta destino,
favorecido e data prevista.

## 4. Receitas

Classificações: **ativa fixa** (salário, pró-labore, contrato), **ativa
variável** (comissão, vendas, honorários), **passiva fixa** (aluguel,
royalties, renda contratual), **passiva variável** (dividendos, lucros,
rendimentos, participações).

Campos de desconto (previsto e realizado, separados): imposto, previdência,
taxas, comissões, outros. Líquido = bruto − somatório de descontos (fórmulas
em `CALCULATIONS.md` §2). Suporta única/parcelada/recorrente, fixa/variável,
recebimento parcial, antecipação, cancelamento de futuras. Categorias e
subcategorias com ícone, cor, ordenação, arquivamento e metas mensal/anual.

**O Dashboard usa receita líquida realizada por padrão**, exibindo bruta,
descontos, líquida, % de descontos e previsto × realizado (bruto e líquido).

## 5. Despesas

16 categorias padrão (editáveis, com subcategorias, ícone, cor, ordenação,
arquivamento — arquivar **não** apaga lançamentos): Moradia; Transporte;
Alimentação; Saúde e Beleza; Despesas Básicas; Desenvolvimento Pessoal;
Lazer; Sistemas e Apps; Vestuários e Calçados; Comemorações e Presentes;
Secretária e Empregada; Filhos e Familiares; Financeiras; Dízimos e Ofertas;
Doações; Doações para Familiares.

Visual: Categoria → Subcategoria → Lançamentos (pastas expansíveis; máximo
2 níveis + lançamento). Ações: marcar como paga, pagamento parcial, adiar,
sem demanda, duplicar, editar, excluir com confirmação, copiar Pix/boleto/
dados bancários.

### Limites de categoria

Limite mensal/anual por categoria ou subcategoria, com tolerância e vigência.
Indicadores: realizado, limite, disponível, % consumido, projeção, comparação
com período anterior. Faixas: `<80%` dentro; `80–<100%` atenção; `=100%`
**limite atingido**; `>100%` **ultrapassado**. _100% nunca é ultrapassagem_ —
regra aplicada em cards, gráficos, alertas, relatórios, Dashboard e Nylo.

## 6. Regra 50/20/30

Base: **receita líquida realizada do período**. Ideal: despesas ≤50%;
financiamentos de consumo próprio ≤20%; investimentos ≥30%. Fórmulas e casos
de borda em `CALCULATIONS.md` §4 (50%, 20% e 30% exatos estão dentro).

**Financiamento de consumo próprio** (entra nos 20%): residência própria,
veículo pessoal, móveis/eletrodomésticos/eletrônicos parcelados, compras
pessoais parceladas, empréstimos de consumo. **Não entra**: imóvel/construção
para venda, terreno de investimento, veículo para revenda, empreendimento,
ativo de renda, parcela de projeto comercial, aporte. Toda dívida/parcela tem
`purpose_classification`: `personal_consumption` | `investment` |
`commercial_project` | `other` — só `personal_consumption` entra nos 20%.

Dashboard: gráfico de rosca com despesas, financiamentos, investimentos,
não alocado e excesso; por faixa: % atual, % ideal, valor, diferença, status.
Alertas: despesas >50%; financiamentos >20%; investimentos <30%; saídas >
receita líquida; classificação de finalidade pendente. A Nylo explica qual
indicador está fora, quanto mudar, categorias que contribuíram e simulação
de retorno à faixa.

## 7. Investimentos

Grupos padrão: Investimentos imobiliários; Longo prazo; Reserva de emergência
e oportunidade; Projetos futuros. Hierarquia: Grupo → Objetivo/carteira →
Ativo/projeto → Aportes.

Aporte realizado: (1) reduz conta de origem; (2) registra saída de caixa;
(3) aumenta saldo do investimento; (4) atualiza meta; (5) **não** é despesa
de consumo; (6) atualiza Dashboard. Suporta único/mensal/variável/parcelado,
edição de série, registro parcial, antecipação, cancelamento futuro.

**Reserva de emergência**: meta manual **ou** calculada (meses desejados ×
média mensal de despesas essenciais — categorias essenciais configuráveis).
Sem quantidade fixa imposta. Exibe alvo, saldo, %, aporte recomendado, prazo.

## 8. Dívidas

Área própria (dívida ≠ despesa simples). Tipos: financiamento imobiliário,
de veículo, empréstimo, cartão parcelado, dívida pessoal, tributo, acordo,
dívida de projeto, outros. Campos: credor, categoria, **finalidade**, valor
original, saldo devedor, valor pago, juros (valor e tipo), parcelas
(total/restantes), datas, valor da parcela, bem vinculado, projeto vinculado,
instruções de pagamento, status.

Pagamento de dívida: reduz caixa; reduz saldo devedor; atualiza valor pago,
%, passivos e patrimônio líquido; **não reduz o patrimônio bruto do bem**.

Painel: saldo total, pago, restante, pagamentos do mês, próximos vencimentos,
atrasos, progresso geral/individual/por categoria. Metas de quitação com
simulação de antecipação.

## 9. Patrimônio

Ativo = bem/aplicação com valor econômico. Patrimônio bruto = Σ valores
atuais. Passivos = Σ saldos devedores. **Patrimônio líquido = bruto −
passivos.** Percentual de propriedade e dívida vinculada por ativo
(fórmulas em `CALCULATIONS.md` §5).

Tipos: imóvel, terreno, veículo, empresa, participação, investimento
financeiro, equipamento, obra, projeto capitalizável, outros. Eventos:
aquisição, avaliação, valorização, desvalorização, melhoria, aporte,
amortização, venda, baixa, ajuste — mantidos em `asset_valuations` +
transações vinculadas.

Venda de ativo: registra data, valor, conta de destino, custos, quitação de
dívida; arquiva o ativo **preservando o histórico** e registra o impacto.

**Snapshots** (`net_worth_snapshots`): patrimônio bruto, passivos, líquido,
investimentos, caixa e dívidas — mensal (cron) e após alterações relevantes.
Nunca reconstruir histórico antigo a partir do valor atual.

## 10. Negócios e Projetos

Área única (sem páginas por tipo). Tipos: construção para venda, compra e
reforma, compra e venda de veículos, terrenos, empreendimento, projeto
comercial, outro. Hierarquia: Tipo → Projeto → Etapas → custos, receitas,
ativos, dívidas e documentos.

Cada projeto: orçamento, categorias de custo (presets para construção e
veículos), despesas previstas/realizadas, aportes, contas a pagar, dívidas,
ativos, receitas, etapas, documentos, fotos, histórico. Indicadores: custo
previsto/realizado, resultado bruto/líquido, margem líquida, retorno sobre
capital (fórmulas em `CALCULATIONS.md` §6).

Integração: aportes reduzem caixa e não são despesa pessoal; custos pertencem
ao projeto; ativos podem integrar o patrimônio; dívidas entram nos passivos;
venda gera receita do projeto; distribuição ao proprietário pode gerar
receita pessoal; reinvestimento permanece no projeto; **evitar dupla
contabilização** (transação de projeto nunca entra nos agregados pessoais de
consumo).

## 11. Metas e Planejamento

Motor central único (`goals`). Tipos: receita, limite de despesa, aporte,
reserva, investimento, projeto, quitação de dívida, aquisição, patrimônio
bruto, redução de passivos, patrimônio líquido, personalizada. Prazo derivado
das datas (mensal, anual, 5/10/15 anos, personalizado) — **sem duplicar metas
por marco**. Ritmo: valor esperado hoje, diferença, necessidade mensal
atualizada (fórmulas em `CALCULATIONS.md` §7). Status: não iniciada,
adiantada, no ritmo, atenção, atrasada, concluída, vencida.

Página **Planejamento**: consolida todas as metas (sem duplicação) com nome,
área, prazo, alvo, atual, esperado, diferença, %, necessidade mensal, data
final, status. Filtros: todas, anual, 5/10/15 anos, atrasadas, no ritmo,
concluídas, por tipo.

## 12. Dashboard

Primeira página após login. Filtros: espaço, mês, ano, período, anual,
5/10/15 anos. Resumo: receitas brutas/líquidas/previstas/realizadas, despesas
previstas/realizadas, financiamentos, aportes, pagamentos de dívidas, saldo
previsto/realizado, **saldo operacional** e **caixa livre** (≠ patrimônio
líquido; fórmulas em `CALCULATIONS.md` §8).

Blocos: entradas × saídas; previsto × realizado; evolução mensal;
distribuição de despesas; próximos vencimentos; investimentos; reserva;
projetos (capital, custo, venda estimada, lucro, margem, status); patrimônio
(bruto, passivos, líquido, meta, diferença, variação); metas; alertas; ações
pendentes; rosca 50/20/30; botão + pergunta rápida + insights da Nylo;
**botão de privacidade** (oculta valores).

## 13. Alertas

Calculados automaticamente (idempotentes). Níveis: informativo, atenção,
crítico, sucesso. Campos: título, explicação, valor, data, gravidade, ação,
link, visto. 22 regras (receita abaixo do ritmo/previsto, descontos acima,
despesa 80% / =100% "atingido" / >100% "ultrapassado", vencimento próximo,
atraso, aporte não realizado, reserva abaixo, dívida próxima/atrasada, meta
atrasada/concluída, patrimônio abaixo, 50/20/30 fora, dados de pagamento
ausentes, projeto acima do orçamento, margem negativa, insight da Nylo).
**Nunca classificar exatamente 100% como ultrapassado.**

## 14. Relatórios

Mensal, anual, período personalizado; receitas, despesas, categorias,
financiamentos, investimentos, aportes, dívidas, patrimônio, metas, projetos,
50/20/30, previsto × realizado. Filtros, ordenação, cards, tabela, gráficos,
resumo, **exportação CSV** e impressão. A Nylo gera resumo descritivo sem
inventar recomendações.

## 15. UX, identidade visual e páginas

- Princípios: uma ação principal por tela; textos claros; formulários curtos
  com campos avançados recolhidos; confirmações; feedback; estados vazios;
  skeletons; erros úteis; acessibilidade (labels, teclado, contraste, foco,
  erros associados, alt, gráficos com resumo textual, status não só por cor,
  redução de movimento).
- Formatação: BRL, data brasileira, percentuais, timezone `America/Recife`.
- Mobile: navegação inferior (Dashboard, Receitas, Despesas, Planejamento,
  Mais), botão de novo lançamento, tabelas em cards, filtros em drawer,
  formulários em tela cheia. Desktop: menu lateral, seletor de período,
  busca, seletor de espaço, notificações, perfil. Tablet: menu recolhível.
  Nylo acessível por botão persistente.
- Identidade (e-book Domínio Financeiro): verde = crescimento; azul profundo
  = confiança; dourado moderado = patrimônio; vermelho = problema; amarelo =
  atenção; neutros como base. Tema claro (fundo claro, cards brancos) e
  escuro (azul-marinho/grafite, cards elevados, contraste acessível), com
  persistência. Ícones Lucide (DollarSign, Wallet, PiggyBank, TrendingUp/Down,
  BarChart3, PieChart, House, Car, HeartPulse, Gift, Users, Landmark, Target,
  Calendar, AlertTriangle, CircleCheck, HandCoins, Building, BadgeDollarSign,
  Bot, MessageCircle…).
- Rotas públicas: `/login`, `/cadastro`, `/recuperar-senha`,
  `/redefinir-senha`, `/convite/[token]`. Autenticadas: `/` (Dashboard),
  `/receitas`, `/despesas`, `/investimentos`, `/financiamentos`, `/dividas`,
  `/patrimonio`, `/projetos`, `/projetos/[id]`, `/planejamento`, `/nylo`,
  `/nylo/historico`, `/relatorios`, `/membros`, `/configuracoes`.

## 16. Configurações

Pessoais: nome, e-mail, foto, senha, tema, privacidade, timezone.
Espaço: nome, moeda, início do mês, tolerância, limite de alerta, categorias
essenciais, preferências do Dashboard. Membros: convidar, listar, permissões,
revogar, último acesso. Nylo: histórico on/off, limite de uso, retenção,
preferências, tom das respostas, dados utilizáveis.

## 17. Não fazer (restrições permanentes)

Ver `CLAUDE.md` — regras invioláveis. Resumo: sem localStorage como banco;
sem auth simulada; sem autorização só no frontend; sem float para dinheiro;
sem senha compartilhada; sem chave administrativa no navegador; sem cálculos
duplicados; sem exclusão de históricos; transferência ≠ receita; aporte ≠
despesa; financiamento de investimento fora dos 20%; valor de compra ≠ valor
atual; sem metas incompletas; sem telas desconectadas; sem mocks como
produção; sem hierarquia ilimitada; sem código sem tipos; IA sem acesso
irrestrito, sem executar pagamentos, sem prometer retorno, sem inventar
dados; sem conclusão sem testes.
