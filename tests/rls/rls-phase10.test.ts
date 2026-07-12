import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 10: Nylo — isolamento de conversas por usuário E workspace (nem o
// dono lê conversa alheia), retenção, rate status e views de apoio.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let assistant: User;
let stranger: User;
let assistantConversationId: string;

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

describe.skipIf(!databaseUrl)("Nylo (Fase 10)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('owner-f10@teste.com', '{"full_name":"Dona F10"}') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f10@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [assistRow],
      } = await c.query(
        `insert into auth.users (email) values ('assist-f10@teste.com') returning id`
      );
      assistant = {
        id: assistRow.id,
        email: "assist-f10@teste.com",
        workspaceId: ws.id,
      };
      await c.query(
        `insert into workspace_members (workspace_id, user_id, role, status)
         values ($1, $2, 'assistant', 'active')`,
        [ws.id, assistRow.id]
      );

      // Usuário de outro workspace (bootstrap cria o dele).
      const {
        rows: [strangerRow],
      } = await c.query(
        `insert into auth.users (email) values ('stranger-f10@teste.com') returning id`
      );
      const {
        rows: [strangerWs],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        strangerRow.id,
      ]);
      stranger = {
        id: strangerRow.id,
        email: "stranger-f10@teste.com",
        workspaceId: strangerWs.id,
      };
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("conversa nasce com expiração da retenção configurada (padrão 90 dias)", async () => {
    await withUser(assistant, async (c) => {
      const {
        rows: [conv],
      } = await c.query(
        `insert into ai_conversations (workspace_id, user_id, title)
         values ($1, $2, 'Análise de junho') returning id, expires_at`,
        [assistant.workspaceId, assistant.id]
      );
      assistantConversationId = conv.id;
      const { rows } = await c.query(
        `select (expires_at - now()) > interval '89 days'
            and (expires_at - now()) < interval '91 days' as ok
           from ai_conversations where id = $1`,
        [conv.id]
      );
      expect(rows[0].ok).toBe(true);

      await c.query(
        `insert into ai_messages (conversation_id, workspace_id, user_id,
           role, content)
         values ($1, $2, $3, 'user', 'Como foi meu mês?')`,
        [conv.id, assistant.workspaceId, assistant.id]
      );
    });
  });

  it("NEM O DONO lê conversas de outro usuário do mesmo workspace", async () => {
    await withUser(owner, async (c) => {
      const conv = await c.query(
        `select count(*)::int as n from ai_conversations where id = $1`,
        [assistantConversationId]
      );
      expect(conv.rows[0].n).toBe(0);

      const msgs = await c.query(
        `select count(*)::int as n from ai_messages
          where conversation_id = $1`,
        [assistantConversationId]
      );
      expect(msgs.rows[0].n).toBe(0);

      // Nem consegue plantar mensagem em conversa alheia.
      await expectDenied(
        c,
        /row-level security/,
        `insert into ai_messages (conversation_id, workspace_id, user_id,
           role, content)
         values ($1, $2, $3, 'assistant', 'invasão')`,
        [assistantConversationId, owner.workspaceId, owner.id]
      );
    });
  });

  it("usuário não cria conversa em workspace do qual não é membro", async () => {
    await withUser(stranger, async (c) => {
      await expectDenied(
        c,
        /row-level security/,
        `insert into ai_conversations (workspace_id, user_id, title)
         values ($1, $2, 'invasão')`,
        [owner.workspaceId, stranger.id]
      );
    });
  });

  it("rate status: conta minhas mensagens do dia e as do workspace no mês", async () => {
    await withUser(assistant, async (c) => {
      await c.query(
        `insert into ai_usage_logs (workspace_id, user_id, conversation_id,
           model, input_tokens, output_tokens, estimated_cost_usd)
         values ($1, $2, $3, 'test-model', 100, 50, 0.001),
                ($1, $2, $3, 'test-model', 200, 80, 0.002)`,
        [assistant.workspaceId, assistant.id, assistantConversationId]
      );
      const { rows } = await c.query(`select * from nylo_rate_status($1)`, [
        assistant.workspaceId,
      ]);
      expect(rows[0].user_messages_today).toBe(2);
      expect(rows[0].workspace_messages_month).toBeGreaterThanOrEqual(2);
      expect(rows[0].monthly_limit).toBeNull(); // sem limite configurado
    });

    // Não-membro não obtém status de outro workspace.
    await withUser(stranger, async (c) => {
      const { rows } = await c.query(`select * from nylo_rate_status($1)`, [
        owner.workspaceId,
      ]);
      expect(rows).toHaveLength(0);
    });
  });

  it("vencimentos e gasto por categoria respeitam o workspace", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [cat],
      } = await c.query(
        `select id from categories
          where workspace_id = $1 and kind = 'expense' limit 1`,
        [owner.workspaceId]
      );
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           category_id, planned_amount, competence_month, due_date, status,
           created_by)
         values ($1, 'consumer_expense', 'Conta de luz F10', $2, 250.00,
                 date_trunc('month', current_date)::date,
                 current_date + 5, 'planned', $3)`,
        [owner.workspaceId, cat.id, owner.id]
      );

      const up = await c.query(`select * from upcoming_payments($1, 30)`, [
        owner.workspaceId,
      ]);
      expect(up.rows.some((r) => r.description === "Conta de luz F10")).toBe(
        true
      );

      // Realizada no mês entra no gasto por categoria.
      await c.query(
        `insert into transactions (workspace_id, nature, description,
           category_id, actual_amount, competence_month, realized_date,
           status, created_by)
         values ($1, 'consumer_expense', 'Luz paga F10', $2, 180.00,
                 date_trunc('month', current_date)::date, current_date,
                 'realized', $3)`,
        [owner.workspaceId, cat.id, owner.id]
      );
      const spend = await c.query(
        `select * from category_spend($1, current_date, current_date)`,
        [owner.workspaceId]
      );
      const row = spend.rows.find((r) => r.category_id === cat.id);
      expect(row.actual_total).toBe("180.00");
    });

    // Outro workspace não enxerga nada disso.
    await withUser(stranger, async (c) => {
      const up = await c.query(`select * from upcoming_payments($1, 30)`, [
        owner.workspaceId,
      ]);
      expect(up.rows).toHaveLength(0);
    });
  });

  it("expiração remove conversas vencidas (cron via service_role)", async () => {
    await admin(async (c) => {
      await c.query(
        `update ai_conversations set expires_at = now() - interval '1 day'
          where id = $1`,
        [assistantConversationId]
      );
      const { rows } = await c.query(
        `select purge_expired_ai_conversations() as n`
      );
      expect(rows[0].n).toBeGreaterThanOrEqual(1);
    });

    await withUser(assistant, async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from ai_conversations where id = $1`,
        [assistantConversationId]
      );
      expect(rows[0].n).toBe(0);
    });
  });
});
