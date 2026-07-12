import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 7: patrimônio — bruto = Σ valor atual × % propriedade; líquido =
// bruto − passivos; avaliações preservam o valor de compra; venda preserva
// histórico; snapshots idempotentes.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let assistant: User;
let accountId: string;
let houseId: string;

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

describe.skipIf(!databaseUrl)("Patrimônio (Fase 7)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('owner-f7@teste.com', '{"full_name":"Dona F7"}') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f7@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [assistRow],
      } = await c.query(
        `insert into auth.users (email) values ('assist-f7@teste.com') returning id`
      );
      assistant = {
        id: assistRow.id,
        email: "assist-f7@teste.com",
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
         values ($1, 'Conta Patrimonial', 'checking', 0.00, $2) returning id`,
        [ws.id, ownerRow.id]
      );
      accountId = acc.id;
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("ativo nasce com evento de aquisição; assistente não cria ativos", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [house],
      } = await c.query(
        `insert into assets (workspace_id, name, type, purchase_value,
           purchase_date, current_value, ownership_percent, created_by)
         values ($1, 'Casa da praia', 'property', 300000.00,
                 '2024-01-15', 300000.00, 50.00, $2)
         returning id`,
        [owner.workspaceId, owner.id]
      );
      houseId = house.id;

      const events = await c.query(
        `select event_type, value from asset_valuations where asset_id = $1`,
        [houseId]
      );
      expect(events.rows).toEqual([
        { event_type: "acquisition", value: "300000.00" },
      ]);
    });

    await withUser(assistant, async (c) => {
      await expectDenied(c, /row-level security/,
        `insert into assets (workspace_id, name, type, purchase_value, current_value)
         values ($1, 'Invasão', 'vehicle', 10, 10)`,
        [owner.workspaceId]);
    });
  });

  it("avaliação atualiza valor atual sem tocar no valor de compra (assistente pode)", async () => {
    await withUser(assistant, async (c) => {
      await c.query(
        `insert into asset_valuations (workspace_id, asset_id, event_type,
           value, event_date, source, created_by)
         values ($1, $2, 'appraisal', 360000.00, '2026-06-01', 'corretor', $3)`,
        [owner.workspaceId, houseId, assistant.id]
      );

      const { rows } = await c.query(
        `select purchase_value, current_value, valuation_source
           from assets where id = $1`,
        [houseId]
      );
      expect(rows[0].purchase_value).toBe("300000.00"); // intacto
      expect(rows[0].current_value).toBe("360000.00");
      expect(rows[0].valuation_source).toBe("corretor");

      // Histórico completo preservado.
      const history = await c.query(
        `select count(*)::int as n from asset_valuations where asset_id = $1`,
        [houseId]
      );
      expect(history.rows[0].n).toBe(2);
    });
  });

  it("patrimônio: bruto pondera % de propriedade; líquido = bruto − passivos", async () => {
    await admin(async (c) => {
      // Dívida vinculada à casa (também entra nos passivos).
      await c.query(
        `insert into liabilities (workspace_id, name, purpose_classification,
           original_amount, current_balance, asset_id, created_by)
         values ($1, 'Financiamento casa praia', 'personal_consumption',
                 120000.00, 120000.00, $2, $3)`,
        [owner.workspaceId, houseId, owner.id]
      );
    });

    await withUser(owner, async (c) => {
      const { rows } = await c.query(`select * from net_worth_current($1)`, [
        owner.workspaceId,
      ]);
      const n = rows[0];
      // 360000 × 50% = 180000 bruto.
      expect(n.gross_worth).toBe("180000.00");
      expect(n.total_liabilities).toBe("120000.00");
      expect(n.net_worth).toBe("60000.00");
    });
  });

  it("pagar dívida vinculada NÃO altera o valor do bem; líquido sobe pela redução do passivo", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [liability],
      } = await c.query(
        `select id from liabilities
          where workspace_id = $1 and name = 'Financiamento casa praia'`,
        [owner.workspaceId]
      );
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           liability_id, purpose_classification, actual_amount,
           competence_month, realized_date, status, created_by)
         values ($1, 'debt_payment', 'Amortização casa', $2,
                 'personal_consumption', 20000.00, '2027-01-01',
                 '2027-01-10', 'realized', $3)`,
        [owner.workspaceId, liability.id, owner.id]
      );

      const asset = await c.query(
        `select current_value from assets where id = $1`,
        [houseId]
      );
      expect(asset.rows[0].current_value).toBe("360000.00"); // bem intacto

      const { rows } = await c.query(`select * from net_worth_current($1)`, [
        owner.workspaceId,
      ]);
      expect(rows[0].total_liabilities).toBe("100000.00");
      expect(rows[0].net_worth).toBe("80000.00"); // 180000 − 100000
    });
  });

  it("snapshot é idempotente por data e espelha o agregado atual", async () => {
    await withUser(owner, async (c) => {
      await c.query(`select create_net_worth_snapshot($1, '2027-01-31')`, [
        owner.workspaceId,
      ]);
      await c.query(`select create_net_worth_snapshot($1, '2027-01-31')`, [
        owner.workspaceId,
      ]);

      const { rows } = await c.query(
        `select count(*)::int as n from net_worth_snapshots
          where workspace_id = $1 and snapshot_date = '2027-01-31'`,
        [owner.workspaceId]
      );
      expect(rows[0].n).toBe(1);

      const snap = await c.query(
        `select gross_worth, net_worth from net_worth_snapshots
          where workspace_id = $1 and snapshot_date = '2027-01-31'`,
        [owner.workspaceId]
      );
      expect(snap.rows[0].gross_worth).toBe("180000.00");
      expect(snap.rows[0].net_worth).toBe("80000.00");

      // Escrita direta na tabela de snapshots é negada.
      await expectDenied(c, /permission denied|row-level security/,
        `insert into net_worth_snapshots (workspace_id, snapshot_date,
           gross_worth, total_liabilities, net_worth, investments_total, cash_total)
         values ($1, '2027-02-28', 1, 1, 0, 0, 0)`,
        [owner.workspaceId]);
    });
  });

  it("venda: entra no caixa, arquiva o ativo, preserva histórico e sai do bruto", async () => {
    await withUser(owner, async (c) => {
      await c.query(`select sell_asset($1, 400000.00, '2027-02-15', $2, 15000.00)`, [
        houseId,
        accountId,
      ]);

      const asset = await c.query(
        `select status, sale_value, purchase_value from assets where id = $1`,
        [houseId]
      );
      expect(asset.rows[0].status).toBe("sold");
      expect(asset.rows[0].sale_value).toBe("400000.00");
      expect(asset.rows[0].purchase_value).toBe("300000.00"); // preservado

      // Histórico: aquisição + avaliação + venda.
      const history = await c.query(
        `select count(*)::int as n from asset_valuations where asset_id = $1`,
        [houseId]
      );
      expect(history.rows[0].n).toBe(3);

      // Caixa: 400000 − 15000 de custos.
      const balance = await c.query(
        `select balance from account_balances where account_id = $1`,
        [accountId]
      );
      expect(balance.rows[0].balance).toBe("385000.00");

      // Fora do patrimônio bruto após a venda.
      const { rows } = await c.query(`select * from net_worth_current($1)`, [
        owner.workspaceId,
      ]);
      expect(rows[0].gross_worth).toBe("0.00");
    });

    // Assistente não vende (exige edit_assets).
    await withUser(assistant, async (c) => {
      await expectDenied(c, /not_authorized|asset_already_sold/,
        `select sell_asset($1, 1, current_date)`, [houseId]);
    });
  });
});
