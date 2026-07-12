// Provedor de dados de mercado (AI_NYLO §6). Sem provedor configurado,
// a Nylo declara que não tem cotações — NUNCA inventa valores.

export type MarketQuoteResult = {
  available: boolean;
  provider: string | null;
  asOf: string | null;
  quotes: { symbol: string; price: string; currency: string }[];
  notice: string;
};

export interface MarketDataProvider {
  readonly name: string;
  getQuotes(symbols: string[]): Promise<MarketQuoteResult>;
}

class NullMarketDataProvider implements MarketDataProvider {
  readonly name = "nenhum";

  async getQuotes(): Promise<MarketQuoteResult> {
    return {
      available: false,
      provider: null,
      asOf: null,
      quotes: [],
      notice:
        "Nenhum provedor de cotações está configurado neste ambiente. " +
        "Informe ao usuário que não há cotações disponíveis e NUNCA estime valores.",
    };
  }
}

// Ponto único de extensão: quando MARKET_DATA_PROVIDER for configurado,
// registrar aqui a implementação correspondente.
export function getMarketDataProvider(): MarketDataProvider {
  return new NullMarketDataProvider();
}
