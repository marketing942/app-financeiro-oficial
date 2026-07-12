import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 6: dívidas e financiamentos — pagamento reduz caixa e saldo devedor
// sem tocar em bens; regra 50/20/30 com igualdade DENTRO do limite e
// somente consumo próprio nos 20%.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let assistant: User;
let accountId: string;
let liabilityId: string;

async function withUser<T>(
  user: User,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!pool) throw new Error("pool not initialized");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user.id, email: user.email }),
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function expectDenied(
  client: PoolClient,
  pattern: RegExp,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  await client.query("savepoint expect_denied");
  let failure: unknown = null;
  try {
    await client.query(sql, params);
  } catch (error) {
    failure = error;
  }
  await client.query("rollback to savepoint expect_denied");
  expect(failure, `esperava falha em: ${sql}`).toBeTruthy();
  expect(String((failure as Error).message)).toMatch(pattern);
}

async function admin<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error("pool not initialized");
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

describe.skipIf(!databaseUrl)("Dívidas e regra 50/20/30 (Fase 6)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('owner-f6@teste.com', '{"full_name":"Dona F6"}') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f6@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [assistRow],
      } = await c.query(
        `insert into auth.users (email) values ('assist-f6@teste.com') returning id`
      );
      assistant = {
        id: assistRow.id,
        email: "assist-f6@teste.com",
        workspaceId: ws.id,
      };
      await c.query(
        `insert into workspace_members (workspace_id, user_id, role, status)
         values ($1, $2, 'assistant', 'active')`,
        [ws.id, assistRow.id]
      );

      const {
        rows: [acc],
      } = await c.query(
        `insert into financial_accounts (workspace_id, name, type, initial_balance, created_by)
         values ($1, 'Conta Pagadora', 'checking', 5000.00, $2) returning id`,
        [ws.id, ownerRow.id]
      );
      accountId = acc.id;
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("finalidade é obrigatória na dívida; assistente não gerencia dívidas", async () => {
    await withUser(owner, async (c) => {
      await expectDenied(
        c,
        /null value|not-null/,
        `insert into liabilities (workspace_id, name, original_amount, created_by)
         values ($1, 'Sem finalidade', 1000, $2)`,
        [owner.workspaceId, owner.id]
      );

      const {
        rows: [liability],
      } = await c.query(
        `insert into liabilities (workspace_id, name, creditor,
           purpose_classification, original_amount, current_balance,
           installment_count, installment_amount, created_by)
         values ($1, 'Financiamento do carro', 'Banco X',
                 'personal_consumption', 1200.00, 1200.00, 12, 100.00, $2)
         returning id`,
        [owner.workspaceId, owner.id]
      );
      liabilityId = liability.id;
    });

    await withUser(assistant, async (c) => {
      await expectDenied(
        c,
        /row-level security/,
        `insert into liabilities (workspace_id, name, purpose_classification,
           original_amount)
         values ($1, 'Invasão', 'other', 10)`,
        [owner.workspaceId]
      );
    });
  });

  it("pagamento: reduz caixa e saldo devedor, aumenta pago; parcelas e vencimento derivados", async () => {
    await withUser(assistant, async (c) => {
      // Assistente registra pagamento de dívida (atribuição padrão).
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           account_id, liability_id, purpose_classification,
           planned_amount, actual_amount, competence_month, due_date,
           realized_date, status, created_by)
         values ($1, 'debt_payment', 'Parcela 1 carro', $2, $3,
                 'personal_consumption', 100.00, 100.00,
                 '2026-12-01', '2026-12-05', '2026-12-05', 'realized', $4)`,
        [owner.workspaceId, accountId, liabilityId, assistant.id]
      );

      const { rows } = await c.query(
        `select current_balance, paid_amount, installments_remaining, status
           from liabilities where id = $1`,
        [liabilityId]
      );
      expect(rows[0].current_balance).toBe("1100.00");
      expect(rows[0].paid_amount).toBe("100.00");
      expect(rows[0].installments_remaining).toBe(11);
      expect(rows[0].status).toBe("current");

      // Caixa caiu.
      const balance = await c.query(
        `select balance from account_balances where account_id = $1`,
        [accountId]
      );
      expect(balance.rows[0].balance).toBe("4900.00");

      // Vínculo 1:1 automático.
      const link = await c.query(
        `select count(*)::int as n from liability_payments where liability_id = $1`,
        [liabilityId]
      );
      expect(link.rows[0].n).toBe(1);
    });
  });

  it("quitação total: status settled; saldo nunca negativo", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           account_id, liability_id, purpose_classification, actual_amount,
           competence_month, realized_date, status, created_by)
         values ($1, 'debt_payment', 'Quitação carro', $2, $3,
                 'personal_consumption', 1100.00, '2026-12-01',
                 '2026-12-20', 'realized', $4)`,
        [owner.workspaceId, accountId, liabilityId, owner.id]
      );

      const { rows } = await c.query(
        `select current_balance, paid_amount, status from liabilities where id = $1`,
        [liabilityId]
      );
      expect(rows[0].current_balance).toBe("0.00");
      expect(rows[0].paid_amount).toBe("1200.00");
      expect(rows[0].status).toBe("settled");
    });
  });

  it("simulação de antecipação: parcela + extra reduz os meses", async () => {
    let secondLiability = "";
    await withUser(owner, async (c) => {
      const {
        rows: [l],
      } = await c.query(
        `insert into liabilities (workspace_id, name, purpose_classification,
           original_amount, current_balance, installment_amount, created_by)
         values ($1, 'Empréstimo', 'personal_consumption', 1000.00, 1000.00,
                 100.00, $2) returning id`,
        [owner.workspaceId, owner.id]
      );
      secondLiability = l.id;

      const base = await c.query(
        `select * from simulate_liability_payoff($1, 0)`,
        [secondLiability]
      );
      expect(base.rows[0].months_remaining).toBe(10);

      const accelerated = await c.query(
        `select * from simulate_liability_payoff($1, 100.00)`,
        [secondLiability]
      );
      expect(accelerated.rows[0].months_remaining).toBe(5);
      expect(accelerated.rows[0].monthly_payment).toBe("200.00");
    });
  });

  it("50/20/30: igualdades exatas estão DENTRO; só consumo próprio nos 20%", async () => {
    await admin(async (c) => {
      // Mês isolado 2031-05: RL=1000; despesas 500 (=50%);
      // financiamento consumo 200 (=20%); aportes 300 (=30%);
      // + financiamento de INVESTIMENTO 400 (fora dos 20%).
      const {
        rows: [cat],
      } = await c.query(
        `select id from categories where workspace_id = $1 and name = 'Lazer'`,
        [owner.workspaceId]
      );
      const month = "2031-05-01";
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           category_id, purpose_classification, actual_amount,
           competence_month, realized_date, status, created_by)
         values
           ($1, 'income', 'Salário 5-31', null, null, 1000.00, $2, $2, 'realized', $3),
           ($1, 'consumer_expense', 'Despesas 5-31', $4, null, 500.00, $2, $2, 'realized', $3),
           ($1, 'consumer_financing', 'Financiamento casa própria', null,
              'personal_consumption', 200.00, $2, $2, 'realized', $3),
           ($1, 'investment_contribution', 'Aporte 5-31', null, null, 300.00, $2, $2, 'realized', $3),
           ($1, 'consumer_financing', 'Terreno p/ investimento', null,
              'investment', 400.00, $2, $2, 'realized', $3)`,
        [owner.workspaceId, month, owner.id, cat.id]
      );
    });

    await withUser(owner, async (c) => {
      const { rows } = await c.query(
        `select * from rule_50_20_30($1, '2031-05-01', '2031-05-31')`,
        [owner.workspaceId]
      );
      const r = rows[0];
      expect(r.net_income).toBe("1000.00");
      expect(r.pct_expenses).toBe("50.00");
      expect(r.expenses_status).toBe("within"); // exatamente 50% = dentro
      expect(r.pct_financing).toBe("20.00"); // 400 de investimento FICOU FORA
      expect(r.financing_status).toBe("within"); // exatamente 20% = dentro
      expect(r.pct_investments).toBe("30.00");
      expect(r.investments_status).toBe("at_or_above_minimum"); // 30% = mínimo cumprido
      expect(r.unallocated).toBe("0.00");
    });
  });

  it("50/20/30: acima dos limites é sinalizado (50,01% / 20,01% / 29,99%)", async () => {
    await admin(async (c) => {
      // Mês isolado 2031-07: RL=10000; despesas 5001; financ. 2001; aportes 2999.
      const month = "2031-07-01";
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           purpose_classification, actual_amount, competence_month,
           realized_date, status, created_by)
         values
           ($1, 'income', 'Salário 7-31', null, 10000.00, $2, $2, 'realized', $3),
           ($1, 'consumer_expense', 'Despesas 7-31', null, 5001.00, $2, $2, 'realized', $3),
           ($1, 'consumer_financing', 'Financiamento 7-31',
              'personal_consumption', 2001.00, $2, $2, 'realized', $3),
           ($1, 'investment_contribution', 'Aporte 7-31', null, 2999.00, $2, $2, 'realized', $3)`,
        [owner.workspaceId, month, owner.id]
      );
    });

    await withUser(owner, async (c) => {
      const { rows } = await c.query(
        `select * from rule_50_20_30($1, '2031-07-01', '2031-07-31')`,
        [owner.workspaceId]
      );
      const r = rows[0];
      expect(r.expenses_status).toBe("above");
      expect(r.financing_status).toBe("above");
      expect(r.investments_status).toBe("below_minimum");
      expect(r.excess).toBe("1.00"); // saídas 10001 − RL 10000
    });
  });

  it("50/20/30 sem receita: sem base de cálculo (nunca divisão por zero)", async () => {
    await withUser(owner, async (c) => {
      const { rows } = await c.query(
        `select * from rule_50_20_30($1, '2040-01-01', '2040-01-31')`,
        [owner.workspaceId]
      );
      expect(rows[0].expenses_status).toBe("no_base");
      expect(rows[0].pct_expenses).toBeNull();
    });
  });
});
