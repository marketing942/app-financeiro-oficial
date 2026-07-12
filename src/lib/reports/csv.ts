// Geração de CSV — separador ';' (padrão do Excel pt-BR) e BOM UTF-8.
// Função pura: os números chegam prontos das agregações do banco.

const SEPARATOR = ";";

function escapeCell(value: string): string {
  if (
    value.includes(SEPARATOR) ||
    value.includes('"') ||
    value.includes("\n")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(columns: string[], rows: string[][]): string {
  const lines = [
    columns.map(escapeCell).join(SEPARATOR),
    ...rows.map((row) => row.map(escapeCell).join(SEPARATOR)),
  ];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
