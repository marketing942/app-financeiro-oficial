import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 12: série mensal dos relatórios — mesmos números das demais
// agregações, mês a mês, e invisível para quem não é membro.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let stranger: User;

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

async function admin<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error("pool not initialized");
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

describe.skipIf(!databaseUrl)("Relatórios (Fase 12)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email) values ('owner-f12@teste.com') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f12@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [strangerRow],
      } = await c.query(
        `insert into auth.users (email) values ('stranger-f12@teste.com') returning id`
      );
      const {
        rows: [sws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        strangerRow.id,
      ]);
      stranger = {
        id: strangerRow.id,
        email: "stranger-f12@teste.com",
        workspaceId: sws.id,
      };
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("série mensal agrupa por competência e bate com o resumo do período", async () => {
    await withUser(owner, async (c) => {
      const insert = (
        nature: string,
        amount: string,
        month: string,
        purpose: string | null = null
      ) =>
        c.query(
          `insert into transactions (workspace_id, nature, description,
             actual_amount, competence_month, realized_date, status,
             purpose_classification, created_by)
           values ($1, $2, 'F12', $3, $4, $4, 'realized', $5, $6)`,
          [owner.workspaceId, nature, amount, month, purpose, owner.id]
        );

      // Jan/2036: receita 8000, despesa 2000. Fev/2036: receita 6000,
      // aporte 1500 e dívida 500.
      await insert("income", "8000.00", "2036-01-01");
      await insert("consumer_expense", "2000.00", "2036-01-01");
      await insert("income", "6000.00", "2036-02-01");
      await insert("investment_contribution", "1500.00", "2036-02-01");
      await insert(
        "debt_payment",
        "500.00",
        "2036-02-01",
        "personal_consumption"
      );

      const { rows } = await c.query(
        `select * from monthly_series($1, '2036-01-01', '2036-02-28')`,
        [owner.workspaceId]
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].net_income_actual).toBe("8000.00");
      expect(rows[0].expenses_actual).toBe("2000.00");
      expect(rows[0].free_cash).toBe("6000.00");
      expect(rows[1].net_income_actual).toBe("6000.00");
      expect(rows[1].contributions_actual).toBe("1500.00");
      expect(rows[1].debt_payments_actual).toBe("500.00");
      expect(rows[1].free_cash).toBe("4000.00");

      // Consistência: Σ meses = resumo do período (mesma fonte de verdade).
      const summary = await c.query(
        `select * from dashboard_summary($1, '2036-01-01', '2036-02-28')`,
        [owner.workspaceId]
      );
      expect(summary.rows[0].net_income_actual).toBe("14000.00");
      expect(summary.rows[0].free_cash).toBe("10000.00");
    });
  });

  it("não-membro não vê a série de outro workspace", async () => {
    await withUser(stranger, async (c) => {
      const { rows } = await c.query(
        `select * from monthly_series($1, '2036-01-01', '2036-12-31')`,
        [owner.workspaceId]
      );
      expect(rows).toHaveLength(0);
    });
  });
});
