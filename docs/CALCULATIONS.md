# DOMÍNIO FINANCEIRO — Fórmulas Financeiras (Fonte de Verdade)

Todas as fórmulas abaixo são implementadas **no PostgreSQL** (views, funções
e colunas geradas) e testadas em Vitest via casos espelhados + pgTAP/SQL nos
fluxos críticos. O frontend apenas exibe. Valores: `numeric(14,2)`;
percentuais: `numeric(7,2)` com arredondamento half-up na exibição.

Convenções:

- "Período" = intervalo por `competence_month`, respeitando
  `workspace_settings.month_start_day`.
- "Realizado" = transações `status in ('realized','partially_realized')`
  usando `actual_amount` (parciais somam o efetivamente pago/recebido).
- Transações `no_demand`, `canceled` e `deleted_at is not null` **nunca**
  entram em previsto ativo nem em realizado.
- Transferências (`transfer`) nunca entram em receita, despesa ou 50/20/30.

## 1. Previsto × realizado (qualquer natureza)

```
diferenca            = realizado − previsto
percentual_cumprido  = previsto > 0 ? realizado / previsto × 100 : null
```

O planejado é preservado sempre — o realizado nunca o sobrescreve.

## 2. Receita líquida

```
descontos_previstos = imposto_previsto + previdencia_prevista
                    + taxas_previstas + comissoes_previstas
                    + outros_descontos_previstos

liquido_previsto  = bruto_previsto  − descontos_previstos
liquido_realizado = bruto_realizado − (imposto_realizado
                    + previdencia_realizada + taxas_realizadas
                    + comissoes_realizadas + outros_descontos_realizados)

percentual_descontos = bruto > 0 ? descontos / bruto × 100 : 0
```

Colunas geradas `net_amount_planned` / `net_amount_actual` em `transactions`.
Campos de desconto nulos contam como 0. Check: descontos ≥ 0 e líquido pode
ser negativo apenas em `adjustment`.

**Padrão do Dashboard: receita líquida realizada.**

## 3. Limites de categoria (regra do 100%)

```
disponivel            = limite − realizado
percentual_consumido  = limite > 0 ? realizado / limite × 100 : null
projecao_fim_do_mes   = realizado / dias_transcorridos × dias_do_mes
```

Classificação (aplicada em cards, gráficos, alertas, relatórios, Dashboard e Nylo):

| percentual     | status                                    |
| -------------- | ----------------------------------------- |
| < 80%          | dentro do limite                          |
| ≥ 80% e < 100% | atenção                                   |
| **= 100%**     | **limite atingido** (NÃO é ultrapassagem) |
| > 100%         | ultrapassado                              |

Casos de teste obrigatórios: `100.00%` → atingido; `100.01%` → ultrapassado.
A comparação usa o valor numérico exato (sem arredondar antes de classificar).
Tolerância configurada desloca apenas o alerta, nunca a classificação.

## 4. Regra 50/20/30

Base: **receita líquida realizada do período** (`RL`).

```
pct_despesas        = despesas_consumo_realizadas          / RL × 100
pct_financiamentos  = financiamentos_consumo_realizados    / RL × 100
pct_investimentos   = aportes_realizados                   / RL × 100
nao_alocado         = max(0, RL − despesas − financiamentos − aportes − pagamentos_divida_consumo)
excesso             = max(0, saídas_totais − RL)
```

`RL = 0` ⇒ percentuais nulos e status "sem base de cálculo" (nunca divisão
por zero).

Classificação (igualdade está DENTRO):

| faixa          | regra                                                |
| -------------- | ---------------------------------------------------- |
| despesas       | ≤ 50% dentro; > 50% acima do limite                  |
| financiamentos | ≤ 20% dentro; > 20% acima do limite                  |
| investimentos  | ≥ 30% dentro/acima do mínimo; < 30% abaixo do mínimo |

Composição das parcelas:

- **despesas** = `nature='consumer_expense'` realizadas;
- **financiamentos** = `nature in ('consumer_financing','debt_payment')`
  realizadas **com `purpose_classification='personal_consumption'`**.
  Finalidade `investment`/`commercial_project`/`other` **nunca** entra;
- **investimentos** = `nature='investment_contribution'` realizadas
  (aportes pessoais; aportes em projetos comerciais contam como capital do
  projeto e são exibidos à parte, sem entrar nos 30% — decisão documentada:
  os 30% medem construção de patrimônio pessoal direto).

## 5. Patrimônio

### 5.1 Agregados

```
patrimonio_bruto   = Σ (valor_atual × percentual_propriedade) dos ativos ativos
passivos           = Σ saldo_devedor das dívidas não quitadas/canceladas
patrimonio_liquido = patrimonio_bruto − passivos
```

### 5.2 Por ativo

```
variacao             = valor_atual − valor_de_compra
variacao_percentual  = valor_de_compra > 0 ? variacao / valor_de_compra × 100 : null
valor_patrimonial    = valor_atual × percentual_propriedade / 100
valor_liquido_indiv  = valor_patrimonial − saldo_devedor_da_divida_vinculada
```

Valor de compra nunca substitui valor atual: `current_value` vem do evento
de avaliação mais recente; sem avaliação, inicia igual ao valor de compra
com `valuation_source='purchase'`.

### 5.3 Pagamento de dívida

Reduz caixa e saldo devedor, aumenta valor pago e patrimônio líquido
(via redução de passivos). **Não altera o valor do bem.**

### 5.4 Reserva de emergência (meta calculada opcional)

```
media_mensal_essencial = média móvel (janela padrão 6 meses) das despesas
                         realizadas nas categorias essenciais
valor_alvo             = media_mensal_essencial × meses_desejados
percentual             = saldo_reserva / valor_alvo × 100
aporte_recomendado     = meses_restantes > 0
                         ? (valor_alvo − saldo_reserva) / meses_restantes : restante
```

Meta manual permanece possível; nenhuma quantidade de meses é imposta.

### 5.5 Venda de ativo

```
resultado_da_venda = valor_venda − custos_da_venda − valor_de_compra
```

Gera transação `asset_sale` (entrada na conta destino), quita/abate dívida
vinculada se indicado, arquiva o ativo (`status='sold'`) preservando o
histórico de avaliações, e registra o impacto patrimonial no snapshot
seguinte.

## 6. Negócios e projetos

```
custo_total_previsto  = Σ custos previstos (project_cost.planned)
custo_total_realizado = Σ custos realizados (project_cost.actual)
capital_investido     = Σ aportes realizados no projeto
resultado_bruto       = receitas_realizadas − custos_diretos_realizados
resultado_liquido     = receitas − custos − impostos − comissoes
                        − taxas − despesas_de_venda
margem_liquida        = receitas > 0 ? resultado_liquido / receitas × 100 : null
retorno_sobre_capital = capital_investido > 0
                        ? resultado_liquido / capital_investido × 100 : null
```

Impostos/comissões/taxas/despesas de venda são custos com categorias de custo
dedicadas do projeto. Anti-dupla-contabilização: transação com `project_id`
usa natures `project_cost`/`project_income` e **não** entra nos agregados
pessoais; a distribuição de lucro ao proprietário é uma transação `income`
pessoal distinta, vinculada ao projeto apenas por referência.

## 7. Metas (motor de ritmo)

```
valor_restante        = max(0, valor_alvo − valor_atual)
meses_totais          = índice(data_final) − índice(data_inicial), mínimo 1
meses_transcorridos   = índice(hoje) − índice(data_inicial),
                        limitado a [0, meses_totais]
meses_restantes       = max(0, meses_totais − meses_transcorridos)

-- índice(d) = ano(d) × 12 + mês(d) — granularidade de mês-calendário,
-- coerente com competence_month (ex.: jan/2030 → jan/2031 = 12 meses).

necessidade_mensal_inicial   = (valor_alvo − valor_inicial) / meses_totais
valor_esperado_hoje          = valor_inicial
                               + necessidade_mensal_inicial × meses_transcorridos
diferenca_de_ritmo           = valor_atual − valor_esperado_hoje
necessidade_mensal_atualizada = meses_restantes > 0
                                ? valor_restante / meses_restantes
                                : valor_restante
```

Status (tolerância padrão 5% do valor esperado, configurável):

- `not_started`: hoje < data_inicial;
- `completed`: valor_atual ≥ valor_alvo;
- `expired`: hoje > data_final e não concluída;
- `ahead`: diferenca_de_ritmo > +tolerância;
- `on_track`: |diferenca_de_ritmo| ≤ tolerância;
- `attention`: abaixo até 1 necessidade mensal;
- `behind`: abaixo além disso.

Marcos (mensal, anual, 5, 10, 15 anos, data final) são projeções derivadas
da mesma meta — nunca metas duplicadas. Para metas de **limite de despesa** a
lógica inverte (estar abaixo do alvo é bom); o motor recebe a direção
(`maximize`/`minimize`) do tipo da meta.

`valor_atual` por tipo: receita/aporte = Σ realizado do período; reserva/
investimento = saldo; quitação = valor amortizado; patrimônio = agregado
atual; personalizada = override manual.

## 8. Dashboard

```
saldo_previsto    = receitas_liquidas_previstas − saídas_previstas
saldo_realizado   = receitas_liquidas_realizadas − saídas_realizadas

saldo_operacional = receitas_liquidas_realizadas − despesas_realizadas

caixa_livre       = receitas_liquidas_realizadas
                    − despesas_realizadas
                    − financiamentos_realizados
                    − aportes_realizados
                    − pagamentos_de_dividas_realizados
```

**Caixa livre ≠ patrimônio líquido** (caixa é fluxo do período; patrimônio é
estoque). O Dashboard nunca recalcula histórico no navegador: consome
`monthly_cashflow`, `rule_50_20_30`, `net_worth_current`, `goal_progress`,
`upcoming_payments` e `net_worth_snapshots` (evolução).

## 9. Contas e transferências

```
saldo_conta = saldo_inicial
              + Σ entradas realizadas (income, project_income, asset_sale,
                  transfer recebida, adjustment positivo)
              − Σ saídas realizadas (despesas, financiamentos, aportes,
                  pagamentos de dívida, custos de projeto, transfer enviada,
                  asset_acquisition, adjustment negativo)
```

Transferência: uma transação com conta origem e contraconta; entra como
saída na origem e entrada no destino; **não** é receita nem despesa; não
altera patrimônio líquido.

## 10. Parcelas e recorrências

```
valor_por_parcela = round(valor_total / n, 2)
ajuste_ultima     = valor_total − valor_por_parcela × (n − 1)
```

(a última parcela absorve a diferença de arredondamento — Σ parcelas =
valor total, sempre).

Regras de edição de série:

- "só esta": altera apenas a parcela;
- "esta e as próximas": altera filhas futuras não realizadas;
- "toda a série": altera o template + filhas não realizadas;
- **parcelas realizadas/parciais nunca são alteradas nem duplicadas**;
- antecipação: move `due_date` e realiza; cancelamento futuro: marca
  `canceled` da parcela N em diante (`canceled_from_installment`).

Materialização de recorrências: função idempotente que cria as ocorrências
faltantes até o horizonte (padrão: 12 meses), protegida por
`unique (series_id, installment_number)`.

## 11. Alertas (gatilhos numéricos)

| regra                              | condição                                                          |
| ---------------------------------- | ----------------------------------------------------------------- |
| Receita abaixo do ritmo            | realizado < esperado_pró-rata do período                          |
| Receita líquida abaixo do previsto | líquido_realizado < líquido_previsto (fechamento)                 |
| Descontos acima do previsto        | descontos_realizados > descontos_previstos                        |
| Despesa em 80%                     | 80% ≤ pct < 100%                                                  |
| Limite atingido                    | pct = 100%                                                        |
| Limite ultrapassado                | pct > 100%                                                        |
| Vencimento próximo                 | due_date − hoje ≤ horizonte (padrão 7 dias)                       |
| Atraso                             | due_date < hoje e não realizado (status `overdue` via job diário) |
| Aporte não realizado               | aporte planejado vencido no período                               |
| Reserva abaixo                     | saldo < alvo × limiar                                             |
| 50/20/30                           | conforme §4 (>50, >20, <30)                                       |
| Saídas acima da receita            | caixa_livre < 0                                                   |
| Projeto acima do orçamento         | custo_realizado > orçamento                                       |
| Margem negativa                    | resultado_liquido < 0                                             |

## 12. Mapa pergunta → fonte

| #      | pergunta                                             | fonte                           |
| ------ | ---------------------------------------------------- | ------------------------------- |
| 1–2    | previsto/realizado de entrada                        | `monthly_cashflow`              |
| 3–5    | bruta, líquida, descontos                            | `income_statement`              |
| 6–7    | previsto/realizado de saída                          | `monthly_cashflow`              |
| 8–12   | despesas, financiamentos, aportes, projetos, dívidas | `monthly_cashflow` por natureza |
| 13     | sobra de caixa                                       | `caixa_livre` (§8)              |
| 14–16  | bruto, passivos, líquido                             | `net_worth_current`             |
| 17     | evolução patrimonial                                 | `net_worth_snapshots`           |
| 18, 20 | metas e ritmo                                        | `goal_progress`                 |
| 19     | 50/20/30                                             | `rule_50_20_30`                 |
| 21     | atenção                                              | `alerts`                        |
| 22     | próximos                                             | `upcoming_payments`             |
| 23     | lucro de projetos                                    | `project_financials`            |
| 24     | categorias acima                                     | `category_spend`                |
