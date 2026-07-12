import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 9: projetos — presets de custo, indicadores (CALCULATIONS §6) e,
// principalmente, anti-dupla-contabilização: transação de projeto nunca
// entra nos agregados pessoais (50/20/30, demonstrativo de receitas).

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let assistant: User;
let projectId: string;

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

describe.skipIf(!databaseUrl)("Projetos (Fase 9)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('owner-f9@teste.com', '{"full_name":"Dona F9"}') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f9@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [assistRow],
      } = await c.query(
        `insert into auth.users (email) values ('assist-f9@teste.com') returning id`
      );
      assistant = {
        id: assistRow.id,
        email: "assist-f9@teste.com",
        workspaceId: ws.id,
      };
      await c.query(
        `insert into workspace_members (workspace_id, user_id, role, status)
         values ($1, $2, 'assistant', 'active')`,
        [ws.id, assistRow.id]
      );
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("projeto nasce com presets de custo do tipo; assistente não cria projetos", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [p],
      } = await c.query(
        `insert into business_projects (workspace_id, name, type, budget,
           status, created_by)
         values ($1, 'Casa Alfa', 'construction_for_sale', 200000.00,
                 'in_progress', $2) returning id`,
        [owner.workspaceId, owner.id]
      );
      projectId = p.id;

      const { rows } = await c.query(
        `select name, kind from project_cost_categories
          where project_id = $1 order by sort_order`,
        [projectId]
      );
      expect(rows.map((r) => r.name)).toEqual([
        "Terreno",
        "Material",
        "Mão de obra",
        "Projetos e documentação",
        "Impostos",
        "Comissão de venda",
        "Despesas de venda",
      ]);
      expect(rows.filter((r) => r.kind === "direct")).toHaveLength(3);
    });

    await withUser(assistant, async (c) => {
      await expectDenied(
        c,
        /row-level security/,
        `insert into business_projects (workspace_id, name, type)
         values ($1, 'Invasão', 'other')`,
        [owner.workspaceId]
      );
    });
  });

  it("naturezas de projeto exigem project_id; consumo não aceita project_id", async () => {
    await withUser(owner, async (c) => {
      await expectDenied(
        c,
        /transactions_project_nature_check/,
        `insert into transactions (workspace_id, nature, description,
           actual_amount, competence_month, realized_date, status)
         values ($1, 'project_cost', 'Sem projeto', 10, '2034-01-01',
                 '2034-01-05', 'realized')`,
        [owner.workspaceId]
      );

      await expectDenied(
        c,
        /transactions_project_link_check/,
        `insert into transactions (workspace_id, nature, description,
           actual_amount, competence_month, realized_date, status, project_id)
         values ($1, 'consumer_expense', 'Mercado com projeto?', 10,
                 '2034-01-01', '2034-01-05', 'realized', $2)`,
        [owner.workspaceId, projectId]
      );
    });
  });

  it("indicadores: bruto usa custos diretos; líquido desconta tudo; margem e ROI", async () => {
    await withUser(owner, async (c) => {
      const cat = async (name: string) =>
        (
          await c.query(
            `select id from project_cost_categories
              where project_id = $1 and name = $2`,
            [projectId, name]
          )
        ).rows[0].id;

      const insertTx = async (
        nature: string,
        amount: string,
        categoryId: string | null
      ) =>
        c.query(
          `insert into transactions (workspace_id, nature, description,
             project_id, project_cost_category_id, actual_amount,
             competence_month, realized_date, status, created_by)
           values ($1, $2, 'Projeto Casa Alfa', $3, $4, $5,
                   '2034-02-01', '2034-02-10', 'realized', $6)`,
          [owner.workspaceId, nature, projectId, categoryId, amount, owner.id]
        );

      // Capital: 150 mil. Custos diretos: 80k terreno + 40k material.
      // Deduções: 6k impostos + 14k comissão. Receita: 200 mil.
      await insertTx("investment_contribution", "150000.00", null);
      await insertTx("project_cost", "80000.00", await cat("Terreno"));
      await insertTx("project_cost", "40000.00", await cat("Material"));
      await insertTx("project_cost", "6000.00", await cat("Impostos"));
      await insertTx(
        "project_cost",
        "14000.00",
        await cat("Comissão de venda")
      );
      await insertTx("project_income", "200000.00", null);

      const { rows } = await c.query(
        `select * from project_financials($1) where project_id = $2`,
        [owner.workspaceId, projectId]
      );
      const f = rows[0];
      expect(f.capital_invested).toBe("150000.00");
      expect(f.actual_cost).toBe("140000.00");
      expect(f.direct_cost_actual).toBe("120000.00");
      expect(f.deduction_cost_actual).toBe("20000.00");
      expect(f.revenue_actual).toBe("200000.00");
      expect(f.gross_result).toBe("80000.00"); // 200k − 120k diretos
      expect(f.net_result).toBe("60000.00"); // 200k − 140k totais
      expect(f.net_margin).toBe("30.00"); // 60k / 200k
      expect(f.return_on_capital).toBe("40.00"); // 60k / 150k
    });
  });

  it("anti-dupla-contabilização: projeto não entra nos agregados pessoais", async () => {
    await withUser(owner, async (c) => {
      // Receita e despesa PESSOAIS no mesmo mês, para comparação.
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           actual_amount, competence_month, realized_date, status, created_by)
         values
           ($1, 'income', 'Salário', 10000.00, '2034-02-01',
            '2034-02-05', 'realized', $2),
           ($1, 'consumer_expense', 'Mercado', 3000.00, '2034-02-01',
            '2034-02-06', 'realized', $2)`,
        [owner.workspaceId, owner.id]
      );

      // 50/20/30 do mês: só o pessoal + o aporte do projeto (30%).
      const { rows } = await c.query(
        `select net_income, expenses, investments
           from rule_50_20_30($1, '2034-02-01', '2034-02-01')`,
        [owner.workspaceId]
      );
      // Receita de 200k do projeto NÃO vira renda pessoal; custos de 140k
      // NÃO viram despesa pessoal. Aporte destinado a projeto é investimento.
      expect(rows[0].net_income).toBe("10000.00");
      expect(rows[0].expenses).toBe("3000.00");
      expect(rows[0].investments).toBe("150000.00");

      // Demonstrativo de receitas ignora project_income.
      const inc = await c.query(
        `select net_actual from income_statement($1, '2034-02-01', '2034-02-01')`,
        [owner.workspaceId]
      );
      expect(inc.rows[0].net_actual).toBe("10000.00");

      // Distribuição de lucro ao dono É receita pessoal (referência ao projeto).
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           project_id, actual_amount, competence_month, realized_date,
           status, created_by)
         values ($1, 'income', 'Distribuição Casa Alfa', $2, 30000.00,
                 '2034-03-01', '2034-03-05', 'realized', $3)`,
        [owner.workspaceId, projectId, owner.id]
      );
      const dist = await c.query(
        `select net_actual from income_statement($1, '2034-03-01', '2034-03-01')`,
        [owner.workspaceId]
      );
      expect(dist.rows[0].net_actual).toBe("30000.00");

      // ...sem inflar a receita do projeto (só project_income conta).
      const fin = await c.query(
        `select revenue_actual from project_financials($1)
          where project_id = $2`,
        [owner.workspaceId, projectId]
      );
      expect(fin.rows[0].revenue_actual).toBe("200000.00");
    });
  });

  it("etapas ordenadas e view de lançamentos do projeto", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into project_stages (workspace_id, project_id, name,
           sort_order, status)
         values ($1, $2, 'Fundação', 1, 'done'),
                ($1, $2, 'Alvenaria', 2, 'in_progress'),
                ($1, $2, 'Acabamento', 3, 'pending')`,
        [owner.workspaceId, projectId]
      );
      const { rows } = await c.query(
        `select name from project_stages where project_id = $1
          order by sort_order`,
        [projectId]
      );
      expect(rows.map((r) => r.name)).toEqual([
        "Fundação",
        "Alvenaria",
        "Acabamento",
      ]);

      // View: custos + receitas + aportes (6 lançamentos), sem a
      // distribuição pessoal (nature income fica de fora).
      const view = await c.query(
        `select count(*)::int as n from project_transactions
          where project_id = $1`,
        [projectId]
      );
      expect(view.rows[0].n).toBe(6);
    });
  });

  it("meta do tipo projeto lê o resultado líquido do projeto vinculado", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into goals (workspace_id, name, type, related_entity_type,
           related_entity_id, target_value, start_date, end_date, created_by)
         values ($1, 'Lucrar 50 mil na Casa Alfa', 'project', 'project',
                 $2, 50000.00, '2034-01-01', '2035-01-01', $3)`,
        [owner.workspaceId, projectId, owner.id]
      );
      const { rows } = await c.query(
        `select current_value, status from goal_progress($1, '2034-06-01')
          where type = 'project'`,
        [owner.workspaceId]
      );
      // Resultado líquido do projeto: 200k − 140k = 60k ≥ alvo → concluída.
      expect(rows[0].current_value).toBe("60000.00");
      expect(rows[0].status).toBe("completed");
    });
  });

  it("exclusão lógica só pela função auditada; histórico preservado", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [temp],
      } = await c.query(
        `insert into business_projects (workspace_id, name, type, created_by)
         values ($1, 'Projeto descartado', 'other', $2) returning id`,
        [owner.workspaceId, owner.id]
      );

      // Update direto de deleted_at é bloqueado pela policy.
      await expectDenied(
        c,
        /row-level security/,
        `update business_projects set deleted_at = now() where id = $1`,
        [temp.id]
      );

      const { rows } = await c.query(`select soft_delete_project($1)`, [
        temp.id,
      ]);
      expect(rows[0].soft_delete_project).toBe(true);

      const visible = await c.query(
        `select count(*)::int as n from business_projects where id = $1`,
        [temp.id]
      );
      expect(visible.rows[0].n).toBe(0); // sumiu da leitura…
    });

    await admin(async (c) => {
      const { rows } = await c.query(
        `select deleted_at from business_projects
          where name = 'Projeto descartado'`
      );
      expect(rows[0].deleted_at).not.toBeNull(); // …mas não do banco.
    });

    // Assistente sem edit_projects não exclui.
    await withUser(assistant, async (c) => {
      await expectDenied(
        c,
        /not_authorized/,
        `select soft_delete_project($1)`,
        [projectId]
      );
    });
  });
});
