import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 3: RLS de contas, categorias e subcategorias, e bootstrap das 16
// categorias padrão do método em cada workspace novo.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let assistant: User;

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

describe.skipIf(!databaseUrl)("RLS — categorias e contas (Fase 3)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('owner-f3@teste.com', '{"full_name":"Dona F3"}') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f3@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [assistRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('assist-f3@teste.com', '{"full_name":"Assistente F3"}') returning id`
      );
      assistant = {
        id: assistRow.id,
        email: "assist-f3@teste.com",
        workspaceId: ws.id,
      };
      // Membership direta (o fluxo de convite já é coberto na suíte da Fase 2).
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

  it("workspace novo nasce com as 16 categorias padrão de despesa", async () => {
    await withUser(owner, async (c) => {
      const { rows } = await c.query(
        `select name from categories
          where workspace_id = $1 and kind = 'expense' and is_default
          order by sort_order`,
        [owner.workspaceId]
      );
      expect(rows).toHaveLength(16);
      expect(rows[0].name).toBe("Moradia");
      expect(rows[15].name).toBe("Doações para Familiares");
    });
  });

  it("contas: owner cria; assistente lê mas não cria/edita", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into financial_accounts (workspace_id, name, type, initial_balance, created_by)
         values ($1, 'Banco Principal', 'checking', 1000.00, $2)`,
        [owner.workspaceId, owner.id]
      );
    });

    await withUser(assistant, async (c) => {
      const { rows } = await c.query(
        `select name, initial_balance from financial_accounts where workspace_id = $1`,
        [owner.workspaceId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].initial_balance).toBe("1000.00");

      await expectDenied(
        c,
        /row-level security/,
        `insert into financial_accounts (workspace_id, name, type, created_by)
         values ($1, 'Conta Invasora', 'cash', $2)`,
        [owner.workspaceId, assistant.id]
      );

      const upd = await c.query(
        `update financial_accounts set name = 'Alterada' where workspace_id = $1`,
        [owner.workspaceId]
      );
      expect(upd.rowCount).toBe(0);
    });
  });

  it("categorias: assistente sem edit_categories não escreve; com override, escreve", async () => {
    await withUser(assistant, async (c) => {
      await expectDenied(
        c,
        /row-level security/,
        `insert into categories (workspace_id, kind, name)
         values ($1, 'expense', 'Categoria do Assistente')`,
        [owner.workspaceId]
      );

      const upd = await c.query(
        `update categories set name = 'Hackeada'
          where workspace_id = $1 and name = 'Moradia'`,
        [owner.workspaceId]
      );
      expect(upd.rowCount).toBe(0);
    });

    // Owner concede a permissão granular.
    await withUser(owner, async (c) => {
      await c.query(
        `update workspace_members set permissions = '{"edit_categories": true}'
          where workspace_id = $1 and user_id = $2`,
        [owner.workspaceId, assistant.id]
      );
    });

    await withUser(assistant, async (c) => {
      await c.query(
        `insert into categories (workspace_id, kind, name)
         values ($1, 'income', 'Comissões')`,
        [owner.workspaceId]
      );
      const { rows } = await c.query(
        `select name from categories where workspace_id = $1 and kind = 'income'`,
        [owner.workspaceId]
      );
      expect(rows.map((r) => r.name)).toContain("Comissões");
    });
  });

  it("subcategoria precisa pertencer a categoria do mesmo workspace", async () => {
    const foreignCategory = await admin(async (c) => {
      const {
        rows: [stranger],
      } = await c.query(
        `insert into auth.users (email) values ('stranger-f3@teste.com') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        stranger.id,
      ]);
      const {
        rows: [cat],
      } = await c.query(
        `select id from categories where workspace_id = $1 limit 1`,
        [ws.id]
      );
      return cat.id as string;
    });

    await withUser(owner, async (c) => {
      await expectDenied(
        c,
        /same workspace|row-level security/,
        `insert into subcategories (workspace_id, category_id, name)
         values ($1, $2, 'Cruzada')`,
        [owner.workspaceId, foreignCategory]
      );

      // No próprio workspace funciona.
      const {
        rows: [cat],
      } = await c.query(
        `select id from categories where workspace_id = $1 and name = 'Moradia'`,
        [owner.workspaceId]
      );
      await c.query(
        `insert into subcategories (workspace_id, category_id, name)
         values ($1, $2, 'Aluguel')`,
        [owner.workspaceId, cat.id]
      );
    });
  });

  it("arquivar categoria preserva subcategorias e a própria linha", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `update categories set archived_at = now()
          where workspace_id = $1 and name = 'Moradia'`,
        [owner.workspaceId]
      );
      const { rows } = await c.query(
        `select c.archived_at, (select count(*) from subcategories s
            where s.category_id = c.id) as subs
           from categories c
          where c.workspace_id = $1 and c.name = 'Moradia'`,
        [owner.workspaceId]
      );
      expect(rows[0].archived_at).not.toBeNull();
      expect(Number(rows[0].subs)).toBe(1);
    });
  });
});
