/**
 * Prosty eksport do CSV (średnik jako separator i BOM, żeby polski Excel od razu
 * poprawnie rozpoznał kolumny i polskie znaki).
 */
const SEPARATOR = ';';

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'tak' : 'nie';

  let text = String(value).replace(/\r?\n/g, ' ');
  // Ochrona przed "wstrzykiwaniem formuł": komórka zaczynająca się od = + - @ mogłaby
  // zostać wykonana przez arkusz kalkulacyjny, więc poprzedzamy ją apostrofem.
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;

  if (text.includes(SEPARATOR) || text.includes('"')) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * @param {{ key: string, label: string }[]} columns
 * @param {object[]} rows zwykłe obiekty (np. wyniki Sequelize z raw: true)
 */
function toCsv(columns, rows) {
  const header = columns.map((c) => formatValue(c.label)).join(SEPARATOR);
  const body = rows.map((row) => columns.map((c) => formatValue(row[c.key])).join(SEPARATOR));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}

module.exports = { toCsv };
