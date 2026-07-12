import { describe, expect, it } from "vitest";

import {
  decimalToCents,
  formatBRL,
  formatCentsBRL,
  parseMoneyInput,
} from "./money";

describe("parseMoneyInput", () => {
  it("aceita formato brasileiro completo", () => {
    expect(parseMoneyInput("1.234,56")).toBe("1234.56");
    expect(parseMoneyInput("1.234.567,89")).toBe("1234567.89");
    expect(parseMoneyInput("0,50")).toBe("0.50");
  });

  it("aceita vírgula decimal sem milhar", () => {
    expect(parseMoneyInput("1234,5")).toBe("1234.50");
    expect(parseMoneyInput("1234,56")).toBe("1234.56");
  });

  it("aceita ponto decimal (formato canônico)", () => {
    expect(parseMoneyInput("1234.56")).toBe("1234.56");
    expect(parseMoneyInput("99.9")).toBe("99.90");
  });

  it("trata ponto com 3 dígitos como milhar (pt-BR)", () => {
    expect(parseMoneyInput("1.234")).toBe("1234.00");
    expect(parseMoneyInput("12.345")).toBe("12345.00");
  });

  it("aceita inteiro puro e zero", () => {
    expect(parseMoneyInput("1500")).toBe("1500.00");
    expect(parseMoneyInput("0")).toBe("0.00");
  });

  it("aceita negativos e normaliza -0", () => {
    expect(parseMoneyInput("-250,10")).toBe("-250.10");
    expect(parseMoneyInput("-0,00")).toBe("0.00");
  });

  it("rejeita entradas inválidas", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("12,345")).toBeNull(); // 3 casas decimais
    expect(parseMoneyInput("1,23,45")).toBeNull();
    expect(parseMoneyInput("1234567890123")).toBeNull(); // > numeric(14,2)
  });
});

describe("decimalToCents", () => {
  it("converte sem passar por float", () => {
    expect(decimalToCents("1234.56")).toBe(123456n);
    expect(decimalToCents("0.1")).toBe(10n);
    expect(decimalToCents("-99.99")).toBe(-9999n);
    // Caso clássico de erro de float: 0.1 + 0.2
    expect(decimalToCents("0.10") + decimalToCents("0.20")).toBe(30n);
  });

  it("rejeita strings inválidas", () => {
    expect(() => decimalToCents("abc")).toThrow();
    expect(() => decimalToCents("1.234,56")).toThrow();
  });
});

describe("formatCentsBRL / formatBRL", () => {
  it("formata com milhar e decimal brasileiros", () => {
    expect(formatCentsBRL(123456n)).toBe("R$ 1.234,56");
    expect(formatCentsBRL(100n)).toBe("R$ 1,00");
    expect(formatCentsBRL(5n)).toBe("R$ 0,05");
    expect(formatCentsBRL(123456789012n)).toBe("R$ 1.234.567.890,12");
  });

  it("formata negativos e nulos", () => {
    expect(formatCentsBRL(-123456n)).toBe("-R$ 1.234,56");
    expect(formatBRL(null)).toBe("R$ 0,00");
    expect(formatBRL("1500.00")).toBe("R$ 1.500,00");
  });
});
