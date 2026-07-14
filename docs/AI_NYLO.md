# NYLO — Assistente Financeira de IA

Nylo (do Rio Nilo: fertilidade, desenvolvimento, prosperidade) ajuda o
usuário e seus assistentes a compreender, organizar, analisar e planejar a
vida financeira. Este documento define arquitetura, ferramentas, segurança e
limites.

## 1. Arquitetura

```
Cliente (Client Component de chat, streaming SSE)
   │  POST /api/nylo  { conversationId, message, period }
   ▼
Route Handler (Node runtime, servidor)
   1. Autentica sessão Supabase (cookie)
   2. Valida membership + permissões no workspace ativo
   3. Rate limiting (usuário e workspace) via ai_usage_logs
   4. Monta contexto: system prompt + resumo do período + histórico da conversa
   5. Anthropic Messages API (streaming) com tool use (function calling)
   6. Ferramentas executam no data-access layer com o CLIENTE SUPABASE DO
      USUÁRIO (anon key + sessão) → RLS decide o acesso, nunca a IA
   7. Persiste mensagens, tool calls, uso e custo
   ▼
Stream SSE → UI (texto, tabelas, gráficos via Structured Outputs)
```

- SDK oficial Anthropic para TypeScript (`@anthropic-ai/sdk`); **Messages API**
  com streaming e tool use; modelo definido por `ANTHROPIC_MODEL` (env, padrão
  `claude-opus-4-8`); `ANTHROPIC_API_KEY` **somente no servidor** (nunca
  `NEXT_PUBLIC_*`).
- Structured Outputs (JSON Schema estrito) para: dados de gráfico, linhas de
  relatório e rascunhos de lançamento — a UI renderiza componentes nativos
  (Recharts/tabelas), a IA nunca "desenha" números livres nesses blocos.
- Superfícies: página `/nylo` (chat completo + histórico), botão persistente
  no app, painel lateral opcional, card de pergunta rápida e insights no
  Dashboard, sugestões de perguntas contextuais.

## 2. Capacidades

Análise de receitas, despesas, investimentos, financiamentos, dívidas,
patrimônio, metas e projetos; previsto × realizado; tendências e excessos;
gráficos e relatórios; simulações (meta, quitação, aporte); planejamento
patrimonial; explicação de produtos e da regra 50/20/30; educação sobre
mercado (ver §6); rascunhos de lançamentos; apoio ao assistente humano;
lista de vencimentos.

## 3. Ferramentas (function calling)

Todas com schema Zod → JSON Schema, executadas **no servidor**:

| ferramenta                     | fonte de dados                                   |
| ------------------------------ | ------------------------------------------------ |
| `obter_resumo_financeiro`      | `monthly_cashflow` + `income_statement`          |
| `comparar_previsto_realizado`  | `monthly_cashflow`                               |
| `analisar_receitas`            | `income_statement` + transações income           |
| `analisar_despesas`            | `category_spend`                                 |
| `analisar_financiamentos`      | transações financing + liabilities               |
| `analisar_regra_50_20_30`      | `rule_50_20_30`                                  |
| `consultar_investimentos`      | investments + contributions                      |
| `consultar_dividas`            | liabilities + payments                           |
| `consultar_patrimonio`         | `net_worth_current` + snapshots                  |
| `consultar_metas`              | `goal_progress`                                  |
| `consultar_projetos`           | `project_financials`                             |
| `listar_vencimentos`           | `upcoming_payments`                              |
| `gerar_dados_de_grafico`       | agrega das views (Structured Output p/ Recharts) |
| `gerar_relatorio`              | mesmas views dos relatórios                      |
| `simular_meta`                 | motor de metas com parâmetros hipotéticos        |
| `simular_quitacao`             | amortização sobre liabilities                    |
| `simular_aporte`               | projeção de saldo/reserva                        |
| `criar_rascunho_de_lancamento` | produz rascunho estruturado (não grava)          |

Contrato obrigatório de cada ferramenta:

1. valida usuário autenticado; 2. valida workspace da sessão (nunca aceita
   `workspace_id` vindo do modelo); 3. valida permissão do membro; 4. executa
   com o cliente Supabase do usuário (RLS aplicado); 5. usa schema Zod de
   entrada e saída; 6. limita registros (máx. 100 linhas por chamada);
2. registra em `ai_tool_calls` + `audit_logs` quando relevante; 8. jamais
   retorna dados de outro espaço; 9. mascara dados sensíveis (instruções de
   pagamento saem sempre mascaradas para o modelo).

## 4. Fluxo de escrita (rascunho + confirmação)

1. Usuário pede ("lança R$ 250 de luz para dia 10");
2. Nylo interpreta e chama `criar_rascunho_de_lancamento`;
3. Servidor valida o rascunho (Zod + regras de negócio) e o devolve
   estruturado;
4. UI exibe formulário preenchido com todos os campos editáveis;
5. Usuário revisa e **confirma explicitamente** (botão);
6. A confirmação vai por endpoint normal de criação (fora do loop da IA),
   revalidada no servidor com as permissões do usuário;
7. Registro criado com `origin='nylo_draft'`;
8. Auditoria registrada.

A Nylo **nunca** grava diretamente. Sem confirmação → nada acontece.

## 5. Segurança

- Chave Anthropic apenas no servidor; nenhum segredo no bundle do cliente.
- Minimização de dados: apenas agregados e registros necessários à pergunta;
  **nunca** enviar senhas, tokens, CVV, credenciais bancárias, chaves Pix
  completas ou linhas digitáveis (mascarados antes do prompt).
- Rate limiting por usuário e por workspace (mensagens/dia e tokens/mês,
  configuráveis; base: `ai_usage_logs`); limite de mensagens por conversa e
  de tokens por resposta.
- **Prompt injection**: system prompt fixo no servidor; conteúdo do usuário
  jamais substitui regras do sistema; instruções vindas de dados (descrições,
  observações) são tratadas como dados; ferramentas validam tudo no servidor
  — o modelo não tem nenhum poder além das ferramentas expostas; nomes e
  argumentos de ferramenta são validados contra os schemas antes de executar.
- Escrita sempre com confirmação humana (§4); nenhuma ação financeira
  irreversível é possível via Nylo.
- Histórico: usuário pode desativar (`workspace_settings.nylo_history_enabled`
  / preferência pessoal); retenção configurável (`nylo_retention_days`,
  padrão 90 dias) com expiração por cron; conversas isoladas por usuário
  **e** workspace via RLS (nem o owner lê conversas alheias).
- Uso e custo registrados por chamada em `ai_usage_logs` (modelo, tokens,
  custo estimado).

## 6. Limites — a Nylo NÃO pode

Executar pagamentos ou Pix; comprar/vender ativos; contratar investimentos;
apagar sem confirmação; alterar permissões; ignorar RLS; acessar segredos;
prometer rentabilidade; inventar dados; inventar cotações.

### Mercado financeiro (v1 = educação)

Escopo: educação, pesquisa, análise informativa, comparação, explicação de
risco e simulação sobre classes públicas (Tesouro Direto, CDB, LCI, LCA,
fundos, ações, ETFs, FIIs, previdência, câmbio, commodities, criptoativos,
imóveis), considerando objetivo, prazo, liquidez, tolerância a risco,
reserva, concentração, dívidas e conhecimento do usuário.

Linguagem: **proibido** "compre agora", "invista tudo", "retorno garantido",
"você terá esta rentabilidade". **Usar** "considere avaliar", "um cenário
possível", "esta classe possui", "estes são os riscos", "compare custos,
liquidez e tributação". Toda análise externa apresenta: data, fonte, riscos,
caráter educacional e ausência de garantia (bloco padrão de disclaimer
renderizado pela UI).

Arquitetura preparada para provedor externo de cotações via interface
`MarketDataProvider` (env `MARKET_DATA_PROVIDER`); **sem provedor
configurado, a Nylo declara não ter cotações — nunca inventa**.

## 7. System prompt (diretrizes)

Identidade (Nylo, método Domínio Financeiro), idioma pt-BR, tom configurável
(preferências), formatação BRL/datas brasileiras, regra do 100% e da
igualdade no 50/20/30, obrigação de citar período analisado, proibições do
§6, instrução de usar ferramentas em vez de estimar, e de admitir quando não
há dados. O system prompt vive no servidor, versionado no código.

## 8. Testes obrigatórios

- Ferramentas respeitam permissões (assistente sem flag não usa ferramenta
  restrita);
- Nylo não consulta dados de outro workspace (tentativa → negada por RLS);
- Conversas isoladas entre usuários;
- Fluxo de rascunho exige confirmação (sem confirmação, nada é criado);
- Dados de pagamento chegam mascarados ao modelo;
- Rate limit bloqueia acima do teto;
- Simulações não gravam nada.
