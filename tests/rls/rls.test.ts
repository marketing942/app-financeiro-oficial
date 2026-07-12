import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Suite de segurança da Fase 2 (SECURITY.md §9, itens 1–6) contra um
// PostgreSQL REAL com as migrations e policies de produção aplicadas.
// Cada usuário é simulado exatamente como o PostgREST/Supabase faz:
// `set role authenticated` + claims JWT em `request.jwt.claims`.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let ownerA: User;
let assistantA: User;
let strangerB: User;
let inviteToken: string;

async function withUser<T>(
  user: User | null,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!pool) throw new Error("pool not initialized");
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (user) {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: user.id,
          email: user.email,
          role: "authenticated",
        }),
      ]);
    } else {
      await client.query("set local role anon");
      await client.query("select set_config('request.jwt.claims', '', true)");
    }
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

// Asserta que uma query falha, isolando-a em um savepoint para não
// abortar a transação do restante do teste.
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

async function createUser(email: string, fullName: string): Promise<User> {
  return admin(async (client) => {
    const {
      rows: [row],
    } = await client.query(
      `insert into auth.users (email, raw_user_meta_data)
       values ($1, jsonb_build_object('full_name', $2::text))
       returning id`,
      [email, fullName]
    );
    const {
      rows: [ws],
    } = await client.query(`select id from workspaces where owner_id = $1`, [
      row.id,
    ]);
    return { id: row.id, email, workspaceId: ws.id };
  });
}

describe.skipIf(!databaseUrl)("RLS — espaços e acessos", () => {
  beforeAll(async () => {
    ownerA = await createUser("owner-a@teste.com", "Proprietária A");
    assistantA = await createUser("assistant-a@teste.com", "Assistente A");
    strangerB = await createUser("owner-b@teste.com", "Proprietário B");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("bootstrap: cadastro cria perfil, preferências, workspace, membership, settings e auditoria", async () => {
    await admin(async (c) => {
      const profile = await c.query(
        `select full_name from profiles where id = $1`,
        [ownerA.id]
      );
      expect(profile.rows[0].full_name).toBe("Proprietária A");

      const prefs = await c.query(
        `select theme from user_preferences where user_id = $1`,
        [ownerA.id]
      );
      expect(prefs.rowCount).toBe(1);

      const member = await c.query(
        `select role, status from workspace_members
          where workspace_id = $1 and user_id = $2`,
        [ownerA.workspaceId, ownerA.id]
      );
      expect(member.rows[0]).toMatchObject({ role: "owner", status: "active" });

      const settings = await c.query(
        `select month_start_day from workspace_settings where workspace_id = $1`,
        [ownerA.workspaceId]
      );
      expect(settings.rowCount).toBe(1);

      const audit = await c.query(
        `select 1 from audit_logs
          where workspace_id = $1 and action = 'workspace.created'`,
        [ownerA.workspaceId]
      );
      expect(audit.rowCount).toBe(1);
    });
  });

  it("1. proprietário acessa o próprio espaço", async () => {
    await withUser(ownerA, async (c) => {
      const ws = await c.query(`select id, name from workspaces`);
      expect(ws.rows.map((r) => r.id)).toContain(ownerA.workspaceId);

      const settings = await c.query(
        `select workspace_id from workspace_settings where workspace_id = $1`,
        [ownerA.workspaceId]
      );
      expect(settings.rowCount).toBe(1);
    });
  });

  it("2. convite: criação (owner), preview (anon) e aceite (assistente)", async () => {
    // Token gerado como na aplicação: 32 bytes aleatórios, só o hash persiste.
    const { randomBytes, createHash } = await import("node:crypto");
    inviteToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(inviteToken).digest("hex");

    await withUser(ownerA, async (c) => {
      await c.query(
        `insert into workspace_invitations
           (workspace_id, email, role, permissions, token_hash, expires_at, invited_by)
         values ($1, $2, 'assistant', '{"edit_goals": true}', $3, now() + interval '7 days', $4)`,
        [ownerA.workspaceId, assistantA.email, tokenHash, ownerA.id]
      );
    });

    // Preview funciona sem sessão (quem tem o token é o convidado).
    await withUser(null, async (c) => {
      const preview = await c.query(
        `select * from get_invitation_preview($1)`,
        [inviteToken]
      );
      expect(preview.rows[0]).toMatchObject({
        workspace_name: "Espaço de Proprietária A",
        invited_email: assistantA.email,
        status: "pending",
      });
    });

    await withUser(assistantA, async (c) => {
      const accepted = await c.query(`select accept_invitation($1) as ws`, [
        inviteToken,
      ]);
      expect(accepted.rows[0].ws).toBe(ownerA.workspaceId);
    });

    // Assistente autorizado passa a acessar o espaço.
    await withUser(assistantA, async (c) => {
      const ws = await c.query(`select id from workspaces where id = $1`, [
        ownerA.workspaceId,
      ]);
      expect(ws.rowCount).toBe(1);

      const members = await c.query(
        `select user_id from workspace_members where workspace_id = $1`,
        [ownerA.workspaceId]
      );
      expect(members.rowCount).toBe(2);

      // Vê o nome da proprietária (perfil compartilhado pelo workspace).
      const profile = await c.query(
        `select full_name from profiles where id = $1`,
        [ownerA.id]
      );
      expect(profile.rows[0]?.full_name).toBe("Proprietária A");
    });
  });

  it("aceite reaproveitado é rejeitado; token expirado e e-mail divergente também", async () => {
    await withUser(assistantA, async (c) => {
      await expectDenied(
        c,
        /invitation_already_accepted/,
        `select accept_invitation($1)`,
        [inviteToken]
      );
    });

    const { randomBytes, createHash } = await import("node:crypto");
    const expiredToken = randomBytes(32).toString("base64url");
    const expiredHash = createHash("sha256").update(expiredToken).digest("hex");
    const mismatchToken = randomBytes(32).toString("base64url");
    const mismatchHash = createHash("sha256")
      .update(mismatchToken)
      .digest("hex");

    await admin(async (c) => {
      // Inserções administrativas (bypass) para montar os cenários.
      await c.query(
        `insert into workspace_invitations
           (workspace_id, email, token_hash, expires_at, invited_by)
         values ($1, 'expirado@teste.com', $2, now() - interval '1 hour', $3),
                ($1, 'outro-email@teste.com', $4, now() + interval '7 days', $3)`,
        [ownerA.workspaceId, expiredHash, ownerA.id, mismatchHash]
      );
    });

    await withUser(strangerB, async (c) => {
      await expectDenied(
        c,
        /invitation_expired/,
        `select accept_invitation($1)`,
        [expiredToken]
      );
      await expectDenied(
        c,
        /invitation_email_mismatch/,
        `select accept_invitation($1)`,
        [mismatchToken]
      );
    });
  });

  it("5. assistente não executa ações exclusivas do proprietário", async () => {
    await withUser(assistantA, async (c) => {
      // Não convida membros (RLS nega INSERT).
      await expectDenied(
        c,
        /row-level security/,
        `insert into workspace_invitations
           (workspace_id, email, token_hash, expires_at, invited_by)
         values ($1, 'x@teste.com', 'hash-qualquer', now() + interval '1 day', $2)`,
        [ownerA.workspaceId, assistantA.id]
      );

      // Não altera configurações críticas (0 linhas afetadas).
      const settings = await c.query(
        `update workspace_settings set alert_threshold = 50
          where workspace_id = $1`,
        [ownerA.workspaceId]
      );
      expect(settings.rowCount).toBe(0);

      // Não renomeia o espaço.
      const ws = await c.query(
        `update workspaces set name = 'Invadido' where id = $1`,
        [ownerA.workspaceId]
      );
      expect(ws.rowCount).toBe(0);

      // Não altera as próprias permissões.
      const perms = await c.query(
        `update workspace_members set permissions = '{"edit_categories": true}'
          where workspace_id = $1 and user_id = $2`,
        [ownerA.workspaceId, assistantA.id]
      );
      expect(perms.rowCount).toBe(0);

      // Não lê a auditoria (exclusiva do owner).
      const audit = await c.query(
        `select * from audit_logs where workspace_id = $1`,
        [ownerA.workspaceId]
      );
      expect(audit.rowCount).toBe(0);
    });
  });

  it("permissões: has_permission combina catálogo do papel + overrides", async () => {
    await withUser(assistantA, async (c) => {
      const granted = await c.query(
        `select app.has_permission($1, 'edit_goals') as v`,
        [ownerA.workspaceId]
      );
      expect(granted.rows[0].v).toBe(true); // override do convite

      const denied = await c.query(
        `select app.has_permission($1, 'edit_categories') as v`,
        [ownerA.workspaceId]
      );
      expect(denied.rows[0].v).toBe(false); // default do papel
    });

    await withUser(ownerA, async (c) => {
      const owner = await c.query(
        `select app.has_permission($1, 'qualquer_coisa') as v`,
        [ownerA.workspaceId]
      );
      expect(owner.rows[0].v).toBe(true); // owner sempre passa
    });
  });

  it("6. adulterar workspace_id não permite invasão", async () => {
    await withUser(ownerA, async (c) => {
      // Mesmo o owner não move registros entre espaços: coluna imutável.
      await expectDenied(
        c,
        /workspace_id is immutable/,
        `update workspace_members set workspace_id = $1
          where workspace_id = $2 and user_id = $3`,
        [strangerB.workspaceId, ownerA.workspaceId, assistantA.id]
      );
    });

    await withUser(strangerB, async (c) => {
      // Inserir membership apontando para espaço alheio: RLS nega.
      await expectDenied(
        c,
        /row-level security/,
        `insert into workspace_members (workspace_id, user_id, role)
         values ($1, $2, 'assistant')`,
        [ownerA.workspaceId, strangerB.id]
      );
    });
  });

  it("proprietário nunca é revogado ou rebaixado", async () => {
    await withUser(ownerA, async (c) => {
      await expectDenied(
        c,
        /cannot be demoted or revoked/,
        `update workspace_members set status = 'revoked'
          where workspace_id = $1 and role = 'owner'`,
        [ownerA.workspaceId]
      );

      await expectDenied(
        c,
        /cannot be removed/,
        `delete from workspace_members
          where workspace_id = $1 and role = 'owner'`,
        [ownerA.workspaceId]
      );
    });
  });

  it("auditoria é append-only até para o proprietário", async () => {
    await withUser(ownerA, async (c) => {
      await expectDenied(
        c,
        /permission denied/,
        `update audit_logs set summary = 'adulterado' where workspace_id = $1`,
        [ownerA.workspaceId]
      );

      await expectDenied(
        c,
        /permission denied/,
        `delete from audit_logs where workspace_id = $1`,
        [ownerA.workspaceId]
      );
    });
  });

  it("3. assistente revogado perde acesso imediatamente (leitura e escrita)", async () => {
    await withUser(ownerA, async (c) => {
      const revoked = await c.query(
        `update workspace_members
            set status = 'revoked', revoked_at = now()
          where workspace_id = $1 and user_id = $2`,
        [ownerA.workspaceId, assistantA.id]
      );
      expect(revoked.rowCount).toBe(1);
    });

    await withUser(assistantA, async (c) => {
      const ws = await c.query(`select id from workspaces where id = $1`, [
        ownerA.workspaceId,
      ]);
      expect(ws.rowCount).toBe(0);

      const members = await c.query(
        `select * from workspace_members where workspace_id = $1`,
        [ownerA.workspaceId]
      );
      expect(members.rowCount).toBe(0);

      const settings = await c.query(
        `select * from workspace_settings where workspace_id = $1`,
        [ownerA.workspaceId]
      );
      expect(settings.rowCount).toBe(0);

      // Escrita também bloqueada na hora.
      await expectDenied(
        c,
        /row-level security/,
        `insert into audit_logs (workspace_id, user_id, action, entity_type, summary)
         values ($1, $2, 'x', 'x', 'x')`,
        [ownerA.workspaceId, assistantA.id]
      );
    });
  });

  it("4. usuário não acessa espaço alheio (SELECT/UPDATE/DELETE/INSERT)", async () => {
    await withUser(strangerB, async (c) => {
      const ws = await c.query(`select id from workspaces`);
      expect(ws.rows.map((r) => r.id)).toEqual([strangerB.workspaceId]);

      const members = await c.query(
        `select * from workspace_members where workspace_id = $1`,
        [ownerA.workspaceId]
      );
      expect(members.rowCount).toBe(0);

      const upd = await c.query(
        `update workspaces set name = 'Hackeado' where id = $1`,
        [ownerA.workspaceId]
      );
      expect(upd.rowCount).toBe(0);

      const del = await c.query(`delete from workspaces where id = $1`, [
        ownerA.workspaceId,
      ]);
      expect(del.rowCount).toBe(0);

      // Perfil de quem não compartilha espaço fica invisível.
      const profile = await c.query(`select * from profiles where id = $1`, [
        ownerA.id,
      ]);
      expect(profile.rowCount).toBe(0);
    });
  });

  it("anon não lê nenhuma tabela", async () => {
    await withUser(null, async (c) => {
      await expectDenied(c, /permission denied/, `select * from workspaces`);
      await expectDenied(c, /permission denied/, `select * from profiles`);
    });
  });
});
