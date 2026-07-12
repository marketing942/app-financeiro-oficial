import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { findTool, isToolAllowed, NYLO_TOOLS, type ToolContext } from "./tools";
import { getMarketDataProvider } from "./market";

// Contexto que EXPLODE se qualquer ferramenta "pura" tocar no banco —
// garante que simulações e rascunhos não gravam nem leem nada.
const explodingSupabase = new Proxy(
  {},
  {
    get() {
      throw new Error("acesso ao banco não permitido neste teste");
    },
  }
) as SupabaseClient;

const ctx: ToolContext = {
  supabase: explodingSupabase,
  workspaceId: "00000000-0000-0000-0000-000000000000",
  role: "assistant",
  permissions: {},
  periodFrom: "2026-07-01",
  periodTo: "2026-07-31",
};

describe("ferramentas da Nylo", () => {
  it("assistente sem flag não usa ferramenta restrita; dono sempre pode", () => {
    const restricted = NYLO_TOOLS.filter((t) => t.requires);
    expect(restricted.length).toBeGreaterThanOrEqual(4);
    for (const tool of restricted) {
      expect(isToolAllowed(tool, "assistant", {})).toBe(false);
      expect(isToolAllowed(tool, "assistant", { [tool.requires!]: true })).toBe(
        true
      );
      expect(isToolAllowed(tool, "owner", {})).toBe(true);
    }
  });

  it("rascunho de lançamento NÃO grava nada — só devolve estrutura validada", async () => {
    const tool = findTool("criar_rascunho_de_lancamento")!;
    const result = await tool.execute(ctx, {
      nature: "consumer_expense",
      description: "Conta de luz",
      amount: "250.00",
      date: "2026-07-10",
      isPlanned: true,
    });
    expect(result.structured?.draft?.description).toBe("Conta de luz");
    expect(result.structured?.draft?.amount).toBe("250.00");
  });

  it("rascunho rejeita valores fora do formato canônico", async () => {
    const tool = findTool("criar_rascunho_de_lancamento")!;
    await expect(
      tool.execute(ctx, {
        nature: "consumer_expense",
        description: "Inválido",
        amount: "R$ 250,00",
        date: "2026-07-10",
      })
    ).rejects.toThrow();
  });

  it("simulações são puras: não tocam no banco e não prometem rentabilidade", async () => {
    const meta = await findTool("simular_meta")!.execute(ctx, {
      valor_alvo: 12000,
      valor_atual: 3000,
      meses: 9,
    });
    expect(
      (meta.data as { necessidade_mensal: string }).necessidade_mensal
    ).toBe("1000.00");

    const aporte = await findTool("simular_aporte")!.execute(ctx, {
      aporte_mensal: 500,
      meses: 12,
      saldo_inicial: 1000,
    });
    const data = aporte.data as { saldo_projetado: string; observacao: string };
    expect(data.saldo_projetado).toBe("7000.00");
    expect(data.observacao).toMatch(/não são garantidos/);
  });

  it("sem provedor de cotações, a Nylo declara indisponibilidade — nunca inventa", async () => {
    const provider = getMarketDataProvider();
    const quotes = await provider.getQuotes(["PETR4"]);
    expect(quotes.available).toBe(false);
    expect(quotes.quotes).toHaveLength(0);
    expect(quotes.notice).toMatch(/NUNCA estime/);

    const tool = findTool("consultar_cotacoes")!;
    const result = await tool.execute(ctx, { simbolos: ["PETR4"] });
    expect(result.structured?.marketDisclaimer).toBe(true);
  });

  it("nenhuma ferramenta expõe dados de pagamento sem máscara", () => {
    // Contrato: nenhuma ferramenta consulta payment_instructions cru —
    // o único acesso permitido seria pela view *_masked.
    for (const tool of NYLO_TOOLS) {
      const source = tool.execute.toString();
      expect(source).not.toMatch(/payment_instructions(?!_masked)/);
      expect(source).not.toMatch(/pix_key(?!_masked)/);
      expect(source).not.toMatch(/digitable_line(?!_masked)/);
    }
  });

  it("nomes de ferramenta são únicos e todas têm schema Zod", () => {
    const names = NYLO_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    // 18 da tabela de AI_NYLO §3 + consultar_cotacoes (MarketDataProvider, §6).
    expect(names).toHaveLength(19);
    for (const tool of NYLO_TOOLS) {
      expect(tool.schema).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});
