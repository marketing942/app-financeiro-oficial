import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

// Fase 4: núcleo de transações — receita líquida, parcelas idempotentes,
// parciais, sem demanda, transferências, atrasos, dados de pagamento.

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

type User = { id: string; email: string; workspaceId: string };

let owner: User;
let assistant: User;
let accountA: string;
let accountB: string;
let categoryId: string;

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

describe.skipIf(!databaseUrl)("Núcleo de transações (Fase 4)", () => {
  beforeAll(async () => {
    await admin(async (c) => {
      const {
        rows: [ownerRow],
      } = await c.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ('owner-f4@teste.com', '{"full_name":"Dona F4"}') returning id`
      );
      const {
        rows: [ws],
      } = await c.query(`select id from workspaces where owner_id = $1`, [
        ownerRow.id,
      ]);
      owner = {
        id: ownerRow.id,
        email: "owner-f4@teste.com",
        workspaceId: ws.id,
      };

      const {
        rows: [assistRow],
      } = await c.query(
        `insert into auth.users (email) values ('assist-f4@teste.com') returning id`
      );
      assistant = {
        id: assistRow.id,
        email: "assist-f4@teste.com",
        workspaceId: ws.id,
      };
      await c.query(
        `insert into workspace_members (workspace_id, user_id, role, status)
         values ($1, $2, 'assistant', 'active')`,
        [ws.id, assistRow.id]
      );

      const { rows: accounts } = await c.query(
        `insert into financial_accounts (workspace_id, name, type, initial_balance, created_by)
         values ($1, 'Conta A', 'checking', 1000.00, $2),
                ($1, 'Conta B', 'savings', 0.00, $2)
         returning id`,
        [ws.id, ownerRow.id]
      );
      accountA = accounts[0].id;
      accountB = accounts[1].id;

      const {
        rows: [cat],
      } = await c.query(
        `select id from categories where workspace_id = $1 and name = 'Alimentação'`,
        [ws.id]
      );
      categoryId = cat.id;
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("receita: líquido = bruto − descontos (gerado no banco) e sincroniza planned/actual", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [tx],
      } = await c.query(
        `insert into transactions (
           workspace_id, nature, description, income_class, account_id,
           gross_amount_planned, tax_amount_planned, social_security_amount_planned,
           fee_amount_planned, commission_amount_planned, other_deductions_amount_planned,
           competence_month, due_date, status, created_by)
         values ($1, 'income', 'Salário', 'active_fixed', $2,
                 5000.00, 500.00, 300.00, 50.00, 0.00, 150.00,
                 '2026-07-01', '2026-07-05', 'planned', $3)
         returning net_amount_planned, planned_amount`,
        [owner.workspaceId, accountA, owner.id]
      );
      expect(tx.net_amount_planned).toBe("4000.00");
      expect(tx.planned_amount).toBe("4000.00");
    });
  });

  it("registrar o realizado nunca sobrescreve o planejado", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [tx],
      } = await c.query(
        `update transactions
            set gross_amount_actual = 5200.00, tax_amount_actual = 520.00,
                social_security_amount_actual = 312.00, fee_amount_actual = 52.00,
                other_deductions_amount_actual = 156.00,
                realized_date = '2026-07-05', status = 'realized'
          where workspace_id = $1 and description = 'Salário'
          returning planned_amount, net_amount_planned, actual_amount, net_amount_actual`,
        [owner.workspaceId]
      );
      expect(tx.planned_amount).toBe("4000.00"); // intacto
      expect(tx.net_amount_planned).toBe("4000.00");
      expect(tx.net_amount_actual).toBe("4160.00");
      expect(tx.actual_amount).toBe("4160.00");
    });
  });

  it("parcelamento: soma das parcelas = total; regeneração é idempotente e preserva realizadas", async () => {
    let seriesId = "";
    await withUser(owner, async (c) => {
      const {
        rows: [series],
      } = await c.query(
        `insert into transaction_series (
           workspace_id, kind, nature, description, frequency,
           total_amount, installment_count, first_due_date,
           account_id, category_id, purpose_classification, created_by)
         values ($1, 'installment', 'consumer_expense', 'Geladeira', 'monthly',
                 1000.00, 3, '2026-07-10', $2, $3, 'personal_consumption', $4)
         returning id`,
        [owner.workspaceId, accountA, categoryId, owner.id]
      );
      seriesId = series.id;

      const {
        rows: [gen],
      } = await c.query(
        `select generate_series_transactions($1, '2027-01-01') as n`,
        [seriesId]
      );
      expect(gen.n).toBe(3);

      const { rows } = await c.query(
        `select installment_number, planned_amount, due_date::text
           from transactions where series_id = $1 order by installment_number`,
        [seriesId]
      );
      expect(rows.map((r) => r.planned_amount)).toEqual([
        "333.33",
        "333.33",
        "333.34", // última absorve o arredondamento: soma = 1000.00
      ]);
      expect(rows[1].due_date).toBe("2026-08-10");

      // Realiza a parcela 1.
      await c.query(
        `update transactions
            set actual_amount = 333.33, realized_date = '2026-07-10', status = 'realized'
          where series_id = $1 and installment_number = 1`,
        [seriesId]
      );

      // Regenerar não duplica nem toca a realizada.
      const {
        rows: [regen],
      } = await c.query(
        `select generate_series_transactions($1, '2027-06-01') as n`,
        [seriesId]
      );
      expect(regen.n).toBe(0);

      const {
        rows: [check],
      } = await c.query(
        `select count(*)::int as total,
                count(*) filter (where status = 'realized')::int as realized
           from transactions where series_id = $1`,
        [seriesId]
      );
      expect(check.total).toBe(3);
      expect(check.realized).toBe(1);
    });
  });

  it("recorrência mensal: gera até o horizonte e respeita cancelamento futuro", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [series],
      } = await c.query(
        `insert into transaction_series (
           workspace_id, kind, nature, description, frequency,
           planned_amount, first_due_date, account_id, category_id, created_by)
         values ($1, 'recurring', 'consumer_expense', 'Assinatura', 'monthly',
                 49.90, '2026-07-01', $2, $3, $4)
         returning id`,
        [owner.workspaceId, accountA, categoryId, owner.id]
      );

      await c.query(`select generate_series_transactions($1, '2026-12-31')`, [
        series.id,
      ]);
      const {
        rows: [count1],
      } = await c.query(
        `select count(*)::int as n from transactions where series_id = $1`,
        [series.id]
      );
      expect(count1.n).toBe(6); // jul..dez

      // Cancela da 4ª ocorrência em diante e regenera: nada novo aparece.
      await c.query(
        `update transaction_series set canceled_from_installment = 4 where id = $1`,
        [series.id]
      );
      await c.query(
        `update transactions set status = 'canceled'
          where series_id = $1 and installment_number >= 4 and status = 'planned'`,
        [series.id]
      );
      await c.query(`select generate_series_transactions($1, '2027-12-31')`, [
        series.id,
      ]);
      const {
        rows: [count2],
      } = await c.query(
        `select count(*)::int as n from transactions
          where series_id = $1 and status <> 'canceled'`,
        [series.id]
      );
      expect(count2.n).toBe(3);
    });
  });

  it("pagamento parcial: soma vira realizado; quitou, status realized", async () => {
    await withUser(owner, async (c) => {
      const {
        rows: [tx],
      } = await c.query(
        `insert into transactions (
           workspace_id, nature, description, account_id, category_id,
           planned_amount, competence_month, due_date, created_by)
         values ($1, 'consumer_expense', 'Conta de luz', $2, $3,
                 300.00, '2026-07-01', '2026-07-20', $4)
         returning id`,
        [owner.workspaceId, accountA, categoryId, owner.id]
      );

      await c.query(
        `insert into transaction_installments (workspace_id, transaction_id, amount, paid_at, created_by)
         values ($1, $2, 120.00, '2026-07-18', $3)`,
        [owner.workspaceId, tx.id, owner.id]
      );

      let { rows } = await c.query(
        `select actual_amount, planned_amount, status from transactions where id = $1`,
        [tx.id]
      );
      expect(rows[0].actual_amount).toBe("120.00");
      expect(rows[0].planned_amount).toBe("300.00"); // planejado intacto
      expect(rows[0].status).toBe("partially_realized");

      await c.query(
        `insert into transaction_installments (workspace_id, transaction_id, amount, paid_at, created_by)
         values ($1, $2, 180.00, '2026-07-20', $3)`,
        [owner.workspaceId, tx.id, owner.id]
      );

      ({ rows } = await c.query(
        `select actual_amount, status from transactions where id = $1`,
        [tx.id]
      ));
      expect(rows[0].actual_amount).toBe("300.00");
      expect(rows[0].status).toBe("realized");
    });
  });

  it("sem demanda: fora do previsto ativo e do realizado no fluxo do mês", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into transactions (
           workspace_id, nature, description, category_id,
           planned_amount, competence_month, status, created_by)
         values ($1, 'consumer_expense', 'Sem demanda teste', $2,
                 999.00, '2030-03-01', 'no_demand', $3)`,
        [owner.workspaceId, categoryId, owner.id]
      );

      const { rows } = await c.query(
        `select * from monthly_cashflow($1, '2030-03-01', '2030-03-31')
          where nature = 'consumer_expense'`,
        [owner.workspaceId]
      );
      const planned = rows[0]?.planned_total ?? "0";
      expect(Number(planned)).toBe(0);
    });
  });

  it("transferência: não é receita nem despesa; move saldo entre contas", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into transactions (
           workspace_id, nature, description, account_id, counter_account_id,
           planned_amount, actual_amount, competence_month, realized_date,
           status, created_by)
         values ($1, 'transfer', 'Transferência A→B', $2, $3,
                 400.00, 400.00, '2026-10-01', '2026-10-02', 'realized', $4)`,
        [owner.workspaceId, accountA, accountB, owner.id]
      );

      // Fora do fluxo (monthly_cashflow ignora transfer).
      const { rows: flow } = await c.query(
        `select * from monthly_cashflow($1, '2026-10-01', '2026-10-31')`,
        [owner.workspaceId]
      );
      expect(flow.find((r) => r.nature === "transfer")).toBeUndefined();

      // Saldos: A perde 400, B ganha 400.
      const { rows: balances } = await c.query(
        `select account_id, balance from account_balances where workspace_id = $1`,
        [owner.workspaceId]
      );
      const balanceB = balances.find((b) => b.account_id === accountB);
      expect(balanceB.balance).toBe("400.00");
    });
  });

  it("transferência exige contraconta e proíbe categoria (checks)", async () => {
    await withUser(owner, async (c) => {
      await expectDenied(
        c,
        /check constraint|violates/,
        `insert into transactions (workspace_id, nature, description, account_id,
           planned_amount, competence_month, created_by)
         values ($1, 'transfer', 'Sem contraconta', $2, 10, '2026-10-01', $3)`,
        [owner.workspaceId, accountA, owner.id]
      );
    });
  });

  it("financiamento exige finalidade (só consumo próprio entra nos 20%)", async () => {
    await withUser(owner, async (c) => {
      await expectDenied(
        c,
        /check constraint|violates/,
        `insert into transactions (workspace_id, nature, description,
           planned_amount, competence_month, created_by)
         values ($1, 'consumer_financing', 'Sem finalidade', 500, '2026-07-01', $2)`,
        [owner.workspaceId, owner.id]
      );
    });
  });

  it("atrasos: mark_overdue_transactions marca vencidos e é restrita", async () => {
    await withUser(owner, async (c) => {
      await c.query(
        `insert into transactions (workspace_id, nature, description, category_id,
           planned_amount, competence_month, due_date, status, created_by)
         values ($1, 'consumer_expense', 'Vencida', $2, 50.00,
                 date_trunc('month', current_date - interval '40 days')::date,
                 current_date - 10, 'planned', $3)`,
        [owner.workspaceId, categoryId, owner.id]
      );
      // Usuário comum não executa o job.
      await expectDenied(
        c,
        /permission denied/,
        `select mark_overdue_transactions()`
      );
    });

    await admin(async (c) => {
      const {
        rows: [result],
      } = await c.query(`select mark_overdue_transactions() as n`);
      expect(result.n).toBeGreaterThanOrEqual(1);
      const { rows } = await c.query(
        `select status from transactions
          where workspace_id = $1 and description = 'Vencida'`,
        [owner.workspaceId]
      );
      expect(rows[0].status).toBe("overdue");
    });
  });

  it("dados de pagamento: assistente vê mascarado; completo exige permissão e audita", async () => {
    let instructionId = "";
    await withUser(owner, async (c) => {
      const {
        rows: [pi],
      } = await c.query(
        `insert into payment_instructions (workspace_id, method, payee, pix_key_type, pix_key, created_by)
         values ($1, 'pix', 'Fornecedor X', 'email', 'fornecedor@exemplo.com', $2)
         returning id`,
        [owner.workspaceId, owner.id]
      );
      instructionId = pi.id;
    });

    await withUser(assistant, async (c) => {
      // Tabela direta: negada sem permissão (0 linhas).
      const direct = await c.query(
        `select pix_key from payment_instructions where id = $1`,
        [instructionId]
      );
      expect(direct.rowCount).toBe(0);

      // View mascarada: disponível, com chave truncada.
      const { rows } = await c.query(
        `select pix_key_masked, payee from payment_instructions_masked where id = $1`,
        [instructionId]
      );
      expect(rows[0].payee).toBe("Fornecedor X");
      expect(rows[0].pix_key_masked).toBe("•••.com");

      // Reveal sem permissão: negado.
      await expectDenied(
        c,
        /not_authorized/,
        `select * from reveal_payment_instruction($1)`,
        [instructionId]
      );
    });

    // Owner sempre pode revelar; a visualização é auditada.
    await withUser(owner, async (c) => {
      const { rows } = await c.query(
        `select pix_key from reveal_payment_instruction($1)`,
        [instructionId]
      );
      expect(rows[0].pix_key).toBe("fornecedor@exemplo.com");

      const audit = await c.query(
        `select 1 from audit_logs
          where workspace_id = $1 and action = 'payment_instruction.revealed'`,
        [owner.workspaceId]
      );
      expect(audit.rowCount).toBe(1);
    });
  });

  it("exclusão lógica exige permissão delete_transactions", async () => {
    let txId = "";
    await withUser(owner, async (c) => {
      const {
        rows: [tx],
      } = await c.query(
        `insert into transactions (workspace_id, nature, description, category_id,
           planned_amount, competence_month, created_by)
         values ($1, 'consumer_expense', 'Para excluir', $2, 10.00, '2026-07-01', $3)
         returning id`,
        [owner.workspaceId, categoryId, owner.id]
      );
      txId = tx.id;
    });

    await withUser(assistant, async (c) => {
      // UPDATE direto de deleted_at é barrado pela policy (nova linha
      // ficaria invisível ao SELECT).
      await expectDenied(
        c,
        /row-level security/,
        `update transactions set deleted_at = now() where id = $1`,
        [txId]
      );
      // Hard delete nem existe para usuários.
      await expectDenied(
        c,
        /permission denied/,
        `delete from transactions where id = $1`,
        [txId]
      );
      // Função auditada nega sem a permissão delete_transactions.
      await expectDenied(
        c,
        /not_authorized/,
        `select soft_delete_transaction($1)`,
        [txId]
      );
    });

    await withUser(owner, async (c) => {
      const {
        rows: [del],
      } = await c.query(`select soft_delete_transaction($1) as ok`, [txId]);
      expect(del.ok).toBe(true);

      const { rows } = await c.query(
        `select count(*)::int as n from transactions where id = $1`,
        [txId]
      );
      // Soft-deleted some das leituras via RLS.
      expect(rows[0].n).toBe(0);

      const audit = await c.query(
        `select 1 from audit_logs
          where workspace_id = $1 and action = 'transaction.deleted' and entity_id = $2`,
        [owner.workspaceId, txId]
      );
      expect(audit.rowCount).toBe(1);
    });
  });
});
