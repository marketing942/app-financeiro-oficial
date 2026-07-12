import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 13: manutenção via cron (service_role) — snapshot mensal com
// valores REAIS (impersonação do dono), atrasos marcados, alertas
// recomputados e bloqueio para usuários autenticados.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;

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

describe.skipIf(!databaseUrl)("Manutenção via cron (Fase 13)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email) values ('owner-f13@teste.com') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f13@teste.com",
        workspaceId: ws.id,
      };

      // Patrimônio real para o snapshot: bem de 90 mil (100%).
      await c.query(
        `insert into assets (workspace_id, name, type, purchase_value,
           current_value, created_by)
         values ($1, 'Bem F13', 'vehicle', 90000.00, 90000.00, $2)`,
        [ws.id, ownerRow.id]
      );

      // Conta vencida ontem, ainda planejada (vira atraso no cron).
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           planned_amount, competence_month, due_date, status, created_by)
         values ($1, 'consumer_expense', 'Atrasada F13', 100.00,
                 date_trunc('month', current_date)::date,
                 current_date - 1, 'planned', $2)`,
        [ws.id, ownerRow.id]
      );
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("snapshot mensal via service_role grava valores REAIS (não zeros)", async () => {
    await admin(async (c) => {
      const { rows } = await c.query(`select create_monthly_snapshots() as n`);
      expect(rows[0].n).toBeGreaterThanOrEqual(1);

      const snap = await c.query(
        `select gross_worth, net_worth from net_worth_snapshots
          where workspace_id = $1 and snapshot_date = current_date`,
        [owner.workspaceId]
      );
      expect(snap.rows[0].gross_worth).toBe("90000.00");
      expect(snap.rows[0].net_worth).toBe("90000.00");
    });
  });

  it("manutenção diária marca atrasos e recomputa alertas de todos os espaços", async () => {
    await admin(async (c) => {
      const { rows } = await c.query(`select * from run_daily_maintenance()`);
      expect(rows[0].overdue_marked).toBeGreaterThanOrEqual(1);
      expect(rows[0].alerts_recomputed).toBeGreaterThanOrEqual(1);
    });

    await withUser(owner, async (c) => {
      const tx = await c.query(
        `select status from transactions
          where workspace_id = $1 and description = 'Atrasada F13'`,
        [owner.workspaceId]
      );
      expect(tx.rows[0].status).toBe("overdue");

      const alert = await c.query(
        `select count(*)::int as n from alerts
          where workspace_id = $1 and rule_key = 'payment_overdue'
            and resolved_at is null`,
        [owner.workspaceId]
      );
      expect(alert.rows[0].n).toBe(1);
    });
  });

  it("usuário autenticado não executa as rotinas de manutenção", async () => {
    await withUser(owner, async (c) => {
      await expectDenied(c, /permission denied|not_authorized/,
        `select run_daily_maintenance()`);
      await expectDenied(c, /permission denied|not_authorized/,
        `select create_monthly_snapshots()`);
    });
  });
});
