// Helpers de dinheiro SEM float (CLAUDE.md regra 1): valores monetários
// trafegam como string decimal ("1234.56") e a formatação é feita por
// manipulação de string/BigInt. Cálculos críticos vivem no PostgreSQL.

const MONEY_INPUT_REGEX =
  /^-?(\d{1,3}(\.\d{3})*|\d+)(,\d{1,2})?$|^-?\d+(\.\d{1,2})?$/;

// Converte entrada do usuário pt-BR ("1.234,56", "1234,56", "1234.56",
// "1234") para a forma canônica "1234.56". Retorna null se inválida.
export function parseMoneyInput(raw: string): string | null {
  const input = raw.trim();
  if (input === "" || !MONEY_INPUT_REGEX.test(input)) return null;

  let normalized = input;
  if (input.includes(",")) {
    // Formato brasileiro: "." é milhar, "," é decimal.
    normalized = input.replaceAll(".", "").replace(",", ".");
  } else {
    const dots = (input.match(/\./g) ?? []).length;
    if (dots > 1) {
      // Vários pontos sem vírgula: pontos são milhar ("1.234.567").
      normalized = input.replaceAll(".", "");
    } else if (dots === 1) {
      const fraction = input.split(".")[1];
      // "1.234" com exatamente 3 dígitos é milhar em pt-BR.
      if (fraction.length === 3) normalized = input.replaceAll(".", "");
    }
  }

  const negative = normalized.startsWith("-");
  if (negative) normalized = normalized.slice(1);

  const [intPartRaw, fracRaw = ""] = normalized.split(".");
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(intPart)) return null;
  if (intPart.length > 12) return null; // numeric(14,2)

  const frac = (fracRaw + "00").slice(0, 2);
  if (!/^\d{2}$/.test(frac)) return null;

  const canonical = `${intPart}.${frac}`;
  if (negative && canonical !== "0.00") return `-${canonical}`;
  return canonical;
}

// "1234.56" (canônico, vindo do banco/parse) → centavos como BigInt.
export function decimalToCents(decimal: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(decimal.trim());
  if (!match) {
    throw new Error(`invalid decimal money string: ${decimal}`);
  }
  const [, sign, intPart, fracRaw = ""] = match;
  const frac = (fracRaw + "00").slice(0, 2);
  const cents = BigInt(intPart) * 100n + BigInt(frac);
  return sign === "-" ? -cents : cents;
}

// Centavos → "R$ 1.234,56" (sem passar por float).
export function formatCentsBRL(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const intPart = (abs / 100n).toString();
  const frac = (abs % 100n).toString().padStart(2, "0");

  let grouped = "";
  for (let i = 0; i < intPart.length; i++) {
    const fromEnd = intPart.length - i;
    grouped += intPart[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) grouped += ".";
  }

  return `${negative ? "-" : ""}R$ ${grouped},${frac}`;
}

// Atalho: string decimal do banco → BRL formatado.
export function formatBRL(decimal: string | null | undefined): string {
  if (decimal === null || decimal === undefined || decimal === "") {
    return "R$ 0,00";
  }
  return formatCentsBRL(decimalToCents(decimal));
}
