import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 5: investimentos e aportes — aporte reduz a conta, aumenta o saldo
// do investimento, não é despesa de consumo e nunca é contado em dobro.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let assistant: User;
let accountId: string;
let investmentId: string;

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

describe.skipIf(!databaseUrl)("Investimentos (Fase 5)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('owner-f5@teste.com', '{"full_name":"Dona F5"}') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f5@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [assistRow],
      } = await c.query(
        `insert into auth.users (email) values ('assist-f5@teste.com') returning id`
      );
      assistant = {
        id: assistRow.id,
        email: "assist-f5@teste.com",
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
         values ($1, 'Conta Investidora', 'checking', 10000.00, $2) returning id`,
        [ws.id, ownerRow.id]
      );
      accountId = acc.id;
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("owner cria investimento; assistente sem edit_investments não cria", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [inv],
      } = await c.query(
        `insert into investments (workspace_id, investment_group, name,
           initial_amount, target_amount, created_by)
         values ($1, 'emergency_opportunity', 'Reserva CDB', 1000.00, 30000.00, $2)
         returning id, current_balance`,
        [owner.workspaceId, owner.id]
      );
      investmentId = inv.id;
      expect(inv.current_balance).toBe("0.00"); // trigger ainda não rodou
    });

    await withUser(assistant, async (c) => {
      await expectDenied(
        c,
        /row-level security/,
        `insert into investments (workspace_id, investment_group, name)
         values ($1, 'long_term', 'Invasão')`,
        [owner.workspaceId]
      );
    });
  });

  it("aporte realizado: reduz a conta, aumenta o investimento, não é despesa", async () => {
    await withUser(assistant, async (c) => {
      // Assistente registra aporte (atribuição padrão).
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           account_id, investment_id, planned_amount, actual_amount,
           competence_month, realized_date, status, created_by)
         values ($1, 'investment_contribution', 'Aporte reserva', $2, $3,
                 1500.00, 1500.00, '2026-11-01', '2026-11-05', 'realized', $4)`,
        [owner.workspaceId, accountId, investmentId, assistant.id]
      );

      // Vínculo 1:1 criado automaticamente (sem dupla contabilização).
      const link = await c.query(
        `select count(*)::int as n from investment_contributions
          where investment_id = $1`,
        [investmentId]
      );
      expect(link.rows[0].n).toBe(1);

      // Saldo do investimento: inicial 1000 + aporte 1500.
      const inv = await c.query(
        `select current_balance from investments where id = $1`,
        [investmentId]
      );
      expect(inv.rows[0].current_balance).toBe("2500.00");

      // Conta de origem: 10000 − 1500.
      const balance = await c.query(
        `select balance from account_balances where account_id = $1`,
        [accountId]
      );
      expect(balance.rows[0].balance).toBe("8500.00");

      // Não entra como despesa de consumo no fluxo.
      const flow = await c.query(
        `select * from monthly_cashflow($1, '2026-11-01', '2026-11-30')`,
        [owner.workspaceId]
      );
      const expense = flow.rows.find((r) => r.nature === "consumer_expense");
      expect(expense).toBeUndefined();
      const contribution = flow.rows.find(
        (r) => r.nature === "investment_contribution"
      );
      expect(contribution.actual_total).toBe("1500.00");
    });
  });

  it("excluir (soft) o aporte devolve o saldo do investimento", async () => {
    let txId = "";
    await withUser(owner, async (c) => {
      const {
        rows: [tx],
      } = await c.query(
        `insert into transactions (workspace_id, nature, description,
           account_id, investment_id, actual_amount, competence_month,
           realized_date, status, created_by)
         values ($1, 'investment_contribution', 'Aporte temporário', $2, $3,
                 500.00, '2026-11-01', '2026-11-10', 'realized', $4)
         returning id`,
        [owner.workspaceId, accountId, investmentId, owner.id]
      );
      txId = tx.id;

      const before = await c.query(
        `select current_balance from investments where id = $1`,
        [investmentId]
      );
      expect(before.rows[0].current_balance).toBe("3000.00");

      await c.query(`select soft_delete_transaction($1)`, [txId]);

      const after = await c.query(
        `select current_balance from investments where id = $1`,
        [investmentId]
      );
      expect(after.rows[0].current_balance).toBe("2500.00");
    });
  });

  it("série mensal de aportes gera ocorrências vinculadas ao investimento", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [series],
      } = await c.query(
        `insert into transaction_series (workspace_id, kind, nature,
           description, frequency, planned_amount, first_due_date,
           account_id, investment_id, created_by)
         values ($1, 'recurring', 'investment_contribution', 'Aporte mensal',
                 'monthly', 300.00, '2027-01-05', $2, $3, $4)
         returning id`,
        [owner.workspaceId, accountId, investmentId, owner.id]
      );

      await c.query(`select generate_series_transactions($1, '2027-03-31')`, [
        series.id,
      ]);

      const { rows } = await c.query(
        `select count(*)::int as n,
                count(*) filter (where investment_id = $2)::int as linked
           from transactions where series_id = $1`,
        [series.id, investmentId]
      );
      expect(rows[0].n).toBe(3);
      expect(rows[0].linked).toBe(3);

      // Cada ocorrência ganhou o vínculo 1:1 (sem duplicidade).
      const links = await c.query(
        `select count(*)::int as n from investment_contributions ic
          join transactions t on t.id = ic.transaction_id
         where t.series_id = $1`,
        [series.id]
      );
      expect(links.rows[0].n).toBe(3);
    });
  });

  it("reserva de emergência: meta calculada = média essencial × meses", async () => {
    await admin(async (c) => {
      // Config: 6 meses de reserva; Alimentação como essencial.
      const {
        rows: [cat],
      } = await c.query(
        `select id from categories
          where workspace_id = $1 and name = 'Alimentação'`,
        [owner.workspaceId]
      );
      await c.query(
        `update workspace_settings
            set reserve_target_months = 6,
                essential_category_ids = array[$1::uuid]
          where workspace_id = $2`,
        [cat.id, owner.workspaceId]
      );

      // Despesa essencial realizada em cada um dos últimos 3 meses fechados
      // (média 6m = 3 × 600 / 6 = 300).
      for (let i = 1; i <= 3; i++) {
        await c.query(
          `insert into transactions (workspace_id, nature, description,
             category_id, planned_amount, actual_amount, competence_month,
             realized_date, status, created_by)
           values ($1, 'consumer_expense', 'Mercado', $2, 600.00, 600.00,
                   (date_trunc('month', current_date) - make_interval(months => $3))::date,
                   current_date, 'realized', $4)`,
          [owner.workspaceId, cat.id, i, owner.id]
        );
      }
    });

    await withUser(owner, async (c) => {
      const { rows } = await c.query(
        `select * from emergency_reserve_summary($1)`,
        [owner.workspaceId]
      );
      const summary = rows[0];
      expect(summary.essential_monthly_avg).toBe("300.00");
      expect(summary.computed_target).toBe("1800.00");
      expect(summary.effective_target).toBe("1800.00");
      expect(summary.current_balance).toBe("2500.00");
      // 2500/1800 = 138.89% — acima da meta.
      expect(Number(summary.percent)).toBeCloseTo(138.89, 1);
    });
  });
});
