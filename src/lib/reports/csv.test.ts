import { describe, expect, it } from "vitest";

import { buildCsv } from "./csv";

describe("buildCsv", () => {
  it("usa ';' (Excel pt-BR), BOM UTF-8 e CRLF", () => {
    const csv = buildCsv(["Categoria", "Realizado"], [["Moradia", "1234.56"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Categoria;Realizado\r\n");
    expect(csv).toContain("Moradia;1234.56\r\n");
  });

  it("escapa separador, aspas e quebras de linha", () => {
    const csv = buildCsv(
      ["a"],
      [["tem;separador"], ['tem "aspas"'], ["tem\nquebra"]]
    );
    expect(csv).toContain('"tem;separador"');
    expect(csv).toContain('"tem ""aspas"""');
    expect(csv).toContain('"tem\nquebra"');
  });
});
