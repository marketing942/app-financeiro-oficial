import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 8: motor de metas — ritmo (CALCULATIONS §7), igualdades DENTRO do
// limite (tolerância e regra do 100%), direção minimize, marcos derivados
// (uma meta = uma linha) e RLS por edit_goals.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let assistant: User;
let investmentId: string;
let contributionTxId: string;
let goalId: string;

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

async function progressAt(client: PoolClient, ws: string, today: string) {
  const { rows } = await client.query(
    `select * from goal_progress($1, $2::date)`,
    [ws, today]
  );
  return rows;
}

describe.skipIf(!databaseUrl)("Metas (Fase 8)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('owner-f8@teste.com', '{"full_name":"Dona F8"}') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f8@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [assistRow],
      } = await c.query(
        `insert into auth.users (email) values ('assist-f8@teste.com') returning id`
      );
      assistant = {
        id: assistRow.id,
        email: "assist-f8@teste.com",
        workspaceId: ws.id,
      };
      await c.query(
        `insert into workspace_members (workspace_id, user_id, role, status)
         values ($1, $2, 'assistant', 'active')`,
        [ws.id, assistRow.id]
      );

      const {
        rows: [inv],
      } = await c.query(
        `insert into investments (workspace_id, name, investment_group,
           initial_amount, current_balance, created_by)
         values ($1, 'Aportes F8', 'long_term', 0, 0, $2) returning id`,
        [ws.id, ownerRow.id]
      );
      investmentId = inv.id;
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("assistente sem edit_goals não cria meta; dono cria", async () => {
    await withUser(assistant, async (c) => {
      await expectDenied(
        c,
        /row-level security/,
        `insert into goals (workspace_id, name, type, target_value, end_date)
         values ($1, 'Invasão', 'custom', 1, '2040-01-01')`,
        [owner.workspaceId]
      );
    });

    await withUser(owner, async (c) => {
      const {
        rows: [goal],
      } = await c.query(
        `insert into goals (workspace_id, name, type, related_entity_type,
           related_entity_id, target_value, start_date, end_date, created_by)
         values ($1, 'Aportar 12 mil no ano', 'contribution', 'investment',
                 $2, 12000.00, '2030-01-01', '2031-01-01', $3)
         returning id`,
        [owner.workspaceId, investmentId, owner.id]
      );
      goalId = goal.id;
    });
  });

  it("ritmo exato: esperado pró-rata, diferença zero = no ritmo", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [tx],
      } = await c.query(
        `insert into transactions (workspace_id, nature, description,
           investment_id, actual_amount, competence_month, realized_date,
           status, created_by)
         values ($1, 'investment_contribution', 'Aportes até junho', $2,
                 6000.00, '2030-06-01', '2030-06-15', 'realized', $3)
         returning id`,
        [owner.workspaceId, investmentId, owner.id]
      );
      contributionTxId = tx.id;

      // p_today = 2030-07-01 → 6 de 12 meses; esperado = 6000.
      const [g] = await progressAt(c, owner.workspaceId, "2030-07-01");
      expect(g.months_total).toBe(12);
      expect(g.months_elapsed).toBe(6);
      expect(g.months_remaining).toBe(6);
      expect(g.current_value).toBe("6000.00");
      expect(g.expected_value).toBe("6000.00");
      expect(g.pace_diff).toBe("0.00");
      expect(g.monthly_need_initial).toBe("1000.00");
      expect(g.monthly_need_updated).toBe("1000.00");
      expect(g.progress_percent).toBe("50.00");
      expect(g.status).toBe("on_track");
      expect(g.direction).toBe("maximize");
    });
  });

  it("igualdades DENTRO: exatamente na tolerância = no ritmo; 1 centavo acima = adiantada", async () => {
    await withUser(owner, async (c) => {
      // Tolerância padrão 5% de 6000 = 300. curr = 6300 → |diff| = tol.
      await c.query(
        `update transactions set actual_amount = 6300 where id = $1`,
        [contributionTxId]
      );
      let [g] = await progressAt(c, owner.workspaceId, "2030-07-01");
      expect(g.pace_diff).toBe("300.00");
      expect(g.status).toBe("on_track");

      await c.query(
        `update transactions set actual_amount = 6300.01 where id = $1`,
        [contributionTxId]
      );
      [g] = await progressAt(c, owner.workspaceId, "2030-07-01");
      expect(g.status).toBe("ahead");
    });
  });

  it("atenção até 1 necessidade mensal abaixo; além disso, atrasada", async () => {
    await withUser(owner, async (c) => {
      // Gap de exatamente 1000 (1 necessidade mensal) → atenção.
      await c.query(
        `update transactions set actual_amount = 5000 where id = $1`,
        [contributionTxId]
      );
      let [g] = await progressAt(c, owner.workspaceId, "2030-07-01");
      expect(g.status).toBe("attention");

      await c.query(
        `update transactions set actual_amount = 4999.99 where id = $1`,
        [contributionTxId]
      );
      [g] = await progressAt(c, owner.workspaceId, "2030-07-01");
      expect(g.status).toBe("behind");
    });
  });

  it("não iniciada antes do prazo; vencida depois dele; concluída ao atingir", async () => {
    await withUser(owner, async (c) => {
      let [g] = await progressAt(c, owner.workspaceId, "2029-12-31");
      expect(g.status).toBe("not_started");

      [g] = await progressAt(c, owner.workspaceId, "2031-01-02");
      expect(g.status).toBe("expired");

      await c.query(
        `update transactions set actual_amount = 12000 where id = $1`,
        [contributionTxId]
      );
      // Alvo atingido vale mesmo após o fim (estoque acumulado no período).
      for (const today of ["2030-07-01", "2031-01-02"]) {
        [g] = await progressAt(c, owner.workspaceId, today);
        expect(g.status).toBe("completed");
      }
    });
  });

  it("marcos são derivados: uma meta = uma única linha no motor", async () => {
    await withUser(assistant, async (c) => {
      // Assistente lê o progresso (select liberado a membros).
      const rows = await progressAt(c, owner.workspaceId, "2030-07-01");
      expect(rows).toHaveLength(1);
      expect(rows[0].goal_id).toBe(goalId);
    });
  });

  it("limite de despesa (minimize): 100% = atingido, só acima = ultrapassado", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into goals (workspace_id, name, type, target_value,
           start_date, end_date, created_by)
         values ($1, 'Teto de consumo', 'expense_limit', 1000.00,
                 '2032-01-01', '2032-02-01', $2)`,
        [owner.workspaceId, owner.id]
      );
      const {
        rows: [tx],
      } = await c.query(
        `insert into transactions (workspace_id, nature, description,
           actual_amount, competence_month, realized_date, status, created_by)
         values ($1, 'consumer_expense', 'Consumo do mês', 1000.00,
                 '2032-01-01', '2032-01-20', 'realized', $2) returning id`,
        [owner.workspaceId, owner.id]
      );

      const find = (rows: Record<string, unknown>[]) =>
        rows.find((r) => r.type === "expense_limit")!;

      // Exatamente 100% do limite → atingido (atenção), não ultrapassado.
      let g = find(await progressAt(c, owner.workspaceId, "2032-01-25"));
      expect(g.direction).toBe("minimize");
      expect(g.current_value).toBe("1000.00");
      expect(g.status).toBe("attention");

      // Período encerrado exatamente no limite → cumprida.
      g = find(await progressAt(c, owner.workspaceId, "2032-02-02"));
      expect(g.status).toBe("completed");

      // Um centavo acima → ultrapassado (atrasada); vencida após o fim.
      await c.query(
        `update transactions set actual_amount = 1000.01 where id = $1`,
        [tx.id]
      );
      g = find(await progressAt(c, owner.workspaceId, "2032-01-25"));
      expect(g.status).toBe("behind");
      g = find(await progressAt(c, owner.workspaceId, "2032-02-02"));
      expect(g.status).toBe("expired");
    });
  });

  it("redução de passivos (minimize): esperado decresce; concluída ao chegar no alvo", async () => {
    await admin(async (c) => {
      await c.query(
        `insert into liabilities (workspace_id, name, purpose_classification,
           original_amount, current_balance, created_by)
         values ($1, 'Dívida F8', 'personal_consumption', 20000.00, 20000.00, $2)`,
        [owner.workspaceId, owner.id]
      );
    });

    await withUser(owner, async (c) => {
      await c.query(
        `insert into goals (workspace_id, name, type, initial_value,
           target_value, start_date, end_date, created_by)
         values ($1, 'Reduzir passivos à metade', 'liability_reduction',
                 20000.00, 10000.00, '2033-01-01', '2034-01-01', $2)`,
        [owner.workspaceId, owner.id]
      );

      const find = (rows: Record<string, unknown>[]) =>
        rows.find((r) => r.type === "liability_reduction")!;

      // Meio do prazo: esperado = 15000; passivo segue 20000 → atrasada
      // (diff = −5000, além de 1 necessidade mensal de 833.33).
      let g = find(await progressAt(c, owner.workspaceId, "2033-07-01"));
      expect(g.expected_value).toBe("15000.00");
      expect(g.pace_diff).toBe("-5000.00");
      expect(g.status).toBe("behind");

      // Quitação até o alvo → concluída antes do fim do prazo.
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           liability_id, purpose_classification, actual_amount,
           competence_month, realized_date, status, created_by)
         select $1, 'debt_payment', 'Amortização F8', l.id,
                'personal_consumption', 10000.00, '2033-07-01',
                '2033-07-10', 'realized', $2
           from liabilities l
          where l.workspace_id = $1 and l.name = 'Dívida F8'`,
        [owner.workspaceId, owner.id]
      );
      g = find(await progressAt(c, owner.workspaceId, "2033-08-01"));
      expect(g.current_value).toBe("10000.00");
      expect(g.status).toBe("completed");
    });
  });

  it("meta personalizada usa override; demais tipos não aceitam override", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into goals (workspace_id, name, type, target_value,
           current_value_override, start_date, end_date, created_by)
         values ($1, 'Meta livre', 'custom', 500.00, 200.00,
                 '2035-01-01', '2036-01-01', $2)`,
        [owner.workspaceId, owner.id]
      );
      const rows = await progressAt(c, owner.workspaceId, "2035-06-01");
      const g = rows.find((r) => r.type === "custom")!;
      expect(g.current_value).toBe("200.00");

      // Override em tipo não-custom viola o check.
      await expectDenied(
        c,
        /check constraint|violates/,
        `insert into goals (workspace_id, name, type, target_value,
           current_value_override, start_date, end_date)
         values ($1, 'Inválida', 'income', 1, 1, '2035-01-01', '2036-01-01')`,
        [owner.workspaceId]
      );
    });
  });
});
