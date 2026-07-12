import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 11: resumo do dashboard (saldo operacional ≠ caixa livre) e motor
// de alertas — regra do 100% nos limites de categoria, igualdades do
// 50/20/30 DENTRO, idempotência e resolução automática.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let assistant: User;
let categoryId: string;
let expenseTxId: string;

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

const MONTH = new Date().toISOString().slice(0, 7); // mês corrente
const monthStart = `${MONTH}-01`;

describe.skipIf(!databaseUrl)("Dashboard e alertas (Fase 11)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('owner-f11@teste.com', '{"full_name":"Dona F11"}') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f11@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [assistRow],
      } = await c.query(
        `insert into auth.users (email) values ('assist-f11@teste.com') returning id`
      );
      assistant = {
        id: assistRow.id,
        email: "assist-f11@teste.com",
        workspaceId: ws.id,
      };
      await c.query(
        `insert into workspace_members (workspace_id, user_id, role, status)
         values ($1, $2, 'assistant', 'active')`,
        [ws.id, assistRow.id]
      );

      const {
        rows: [cat],
      } = await c.query(
        `select id from categories
          where workspace_id = $1 and kind = 'expense' limit 1`,
        [ws.id]
      );
      categoryId = cat.id;
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("resumo: saldo operacional ≠ caixa livre; projetos ficam de fora", async () => {
    await withUser(owner, async (c) => {
      const insert = (
        nature: string,
        amount: string,
        extra: Record<string, string> = {}
      ) =>
        c.query(
          `insert into transactions (workspace_id, nature, description,
             actual_amount, competence_month, realized_date, status,
             purpose_classification, created_by)
           values ($1, $2, 'F11 fluxo', $3, $4, $4, 'realized', $5, $6)`,
          [
            owner.workspaceId,
            nature,
            amount,
            monthStart,
            extra.purpose ?? null,
            owner.id,
          ]
        );

      await insert("income", "10000.00");
      await insert("consumer_expense", "3000.00");
      await insert("consumer_financing", "1000.00", {
        purpose: "personal_consumption",
      });
      await insert("investment_contribution", "2000.00");
      await insert("debt_payment", "500.00", {
        purpose: "personal_consumption",
      });

      const { rows } = await c.query(
        `select * from dashboard_summary($1, $2, $2)`,
        [owner.workspaceId, monthStart]
      );
      const s = rows[0];
      expect(s.net_income_actual).toBe("10000.00");
      expect(s.expenses_actual).toBe("3000.00");
      // Operacional: receitas − despesas = 7000.
      expect(s.operating_balance).toBe("7000.00");
      // Caixa livre: − financiamentos − aportes − dívidas = 3500.
      expect(s.free_cash).toBe("3500.00");
      expect(s.balance_actual).toBe("3500.00");
    });
  });

  it("limite de categoria: 80% atenção, exatamente 100% = atingido, acima = ultrapassado", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into category_limits (workspace_id, category_id,
           monthly_limit, valid_from, created_by)
         values ($1, $2, 5000.00, '2020-01-01', $3)`,
        [owner.workspaceId, categoryId, owner.id]
      );
      const {
        rows: [tx],
      } = await c.query(
        `insert into transactions (workspace_id, nature, description,
           category_id, actual_amount, competence_month, realized_date,
           status, created_by)
         values ($1, 'consumer_expense', 'Gasto limite F11', $2, 4000.00,
                 $3, $3, 'realized', $4) returning id`,
        [owner.workspaceId, categoryId, monthStart, owner.id]
      );
      expenseTxId = tx.id;

      // 3000 (anterior) + 4000 = 7000? Não — categoria específica: o gasto
      // do teste anterior não tem categoria. Total da categoria: 4000 = 80%.
      await c.query(`select recompute_alerts($1)`, [owner.workspaceId]);
      let { rows } = await c.query(
        `select rule_key, severity from alerts
          where workspace_id = $1 and rule_key like 'category_limit%'
            and resolved_at is null`,
        [owner.workspaceId]
      );
      expect(rows).toEqual([
        { rule_key: "category_limit_80", severity: "attention" },
      ]);

      // Exatamente 100%: "atingido" (atenção), NUNCA ultrapassado.
      await c.query(
        `update transactions set actual_amount = 5000.00 where id = $1`,
        [expenseTxId]
      );
      await c.query(`select recompute_alerts($1)`, [owner.workspaceId]);
      ({ rows } = await c.query(
        `select rule_key, severity from alerts
          where workspace_id = $1 and rule_key like 'category_limit%'
            and resolved_at is null`,
        [owner.workspaceId]
      ));
      expect(rows).toEqual([
        { rule_key: "category_limit_reached", severity: "attention" },
      ]);

      // Um centavo acima: ultrapassado (crítico); o anterior é resolvido.
      await c.query(
        `update transactions set actual_amount = 5000.01 where id = $1`,
        [expenseTxId]
      );
      await c.query(`select recompute_alerts($1)`, [owner.workspaceId]);
      ({ rows } = await c.query(
        `select rule_key, severity from alerts
          where workspace_id = $1 and rule_key like 'category_limit%'
            and resolved_at is null`,
        [owner.workspaceId]
      ));
      expect(rows).toEqual([
        { rule_key: "category_limit_exceeded", severity: "critical" },
      ]);
    });
  });

  it("recomputação é idempotente e preserva 'visto'", async () => {
    await withUser(owner, async (c) => {
      const before = await c.query(
        `select count(*)::int as n from alerts where workspace_id = $1`,
        [owner.workspaceId]
      );
      const {
        rows: [alert],
      } = await c.query(
        `select id from alerts
          where workspace_id = $1 and rule_key = 'category_limit_exceeded'
          limit 1`,
        [owner.workspaceId]
      );
      await c.query(`select mark_alert_seen($1)`, [alert.id]);

      await c.query(`select recompute_alerts($1)`, [owner.workspaceId]);
      const after = await c.query(
        `select count(*)::int as n from alerts where workspace_id = $1`,
        [owner.workspaceId]
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);

      const seen = await c.query(`select seen_at from alerts where id = $1`, [
        alert.id,
      ]);
      expect(seen.rows[0].seen_at).not.toBeNull();
    });
  });

  it("50/20/30: exatamente 50% NÃO dispara; acima dispara", async () => {
    await withUser(owner, async (c) => {
      // Estado atual: renda 10000; despesas 3000 + 5000.01 = 8000.01 → >50%.
      await c.query(`select recompute_alerts($1)`, [owner.workspaceId]);
      let { rows } = await c.query(
        `select count(*)::int as n from alerts
          where workspace_id = $1 and rule_key = 'expenses_above_50'
            and resolved_at is null`,
        [owner.workspaceId]
      );
      expect(rows[0].n).toBe(1);

      // Ajusta para exatamente 50%: despesas = 5000 → sem alerta (igualdade
      // está DENTRO), e o alerta anterior é resolvido.
      await c.query(
        `update transactions set actual_amount = 2000.00
          where id = $1`,
        [expenseTxId]
      ); // 3000 + 2000 = 5000 = 50% de 10000
      await c.query(`select recompute_alerts($1)`, [owner.workspaceId]);
      ({ rows } = await c.query(
        `select count(*)::int as n from alerts
          where workspace_id = $1 and rule_key = 'expenses_above_50'
            and resolved_at is null`,
        [owner.workspaceId]
      ));
      expect(rows[0].n).toBe(0);

      // Financiamentos: 1000 + 500 dívida = 1500 = 15% ≤ 20 → sem alerta.
      // Aportes: 2000 = 20% < 30 → alerta de atenção presente.
      const invAlert = await c.query(
        `select count(*)::int as n from alerts
          where workspace_id = $1 and rule_key = 'investments_below_30'
            and resolved_at is null`,
        [owner.workspaceId]
      );
      expect(invAlert.rows[0].n).toBe(1);
    });
  });

  it("assistente lê alertas mas não escreve direto na tabela", async () => {
    await withUser(assistant, async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from alerts where workspace_id = $1`,
        [assistant.workspaceId]
      );
      expect(rows[0].n).toBeGreaterThan(0);

      await expectDenied(
        c,
        /permission denied|row-level security/,
        `insert into alerts (workspace_id, rule_key, severity, title, reference_date)
         values ($1, 'fake', 'info', 'x', current_date)`,
        [assistant.workspaceId]
      );
    });
  });

  it("projeto no orçamento exato NÃO alerta; acima alerta", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [p],
      } = await c.query(
        `insert into business_projects (workspace_id, name, type, budget, created_by)
         values ($1, 'Obra F11', 'other', 10000.00, $2) returning id`,
        [owner.workspaceId, owner.id]
      );
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           project_id, actual_amount, competence_month, realized_date,
           status, created_by)
         values ($1, 'project_cost', 'Custo F11', $2, 10000.00, $3, $3,
                 'realized', $4)`,
        [owner.workspaceId, p.id, monthStart, owner.id]
      );
      await c.query(`select recompute_alerts($1)`, [owner.workspaceId]);
      let { rows } = await c.query(
        `select count(*)::int as n from alerts
          where workspace_id = $1 and rule_key = 'project_over_budget'
            and resolved_at is null`,
        [owner.workspaceId]
      );
      expect(rows[0].n).toBe(0); // exatamente no orçamento = dentro

      await c.query(
        `update transactions set actual_amount = 10000.01
          where description = 'Custo F11' and workspace_id = $1`,
        [owner.workspaceId]
      );
      await c.query(`select recompute_alerts($1)`, [owner.workspaceId]);
      ({ rows } = await c.query(
        `select count(*)::int as n from alerts
          where workspace_id = $1 and rule_key = 'project_over_budget'
            and resolved_at is null`,
        [owner.workspaceId]
      ));
      expect(rows[0].n).toBe(1);
    });
  });
});
