/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""),
 * commas and newlines inside quotes, and CRLF. Pure + dependency-free so it
 * runs the same on the client (preview) and could on the server.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a leading UTF-8 BOM (Excel adds one) so the first header cell isn't
  // "﻿name" - which would silently break that column's field mapping.
  const s = text
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  // trailing field/row (unless file ended on a newline)
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Turn CSV text into records keyed by the given field keys. Header cells are
 * matched to fieldKeys case-insensitively (by key or a relaxed label match).
 * Returns the rows plus any field keys the header didn't cover.
 */
export function csvToRows(
  text: string,
  fieldKeys: string[],
): { rows: Record<string, string>[]; missing: string[] } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], missing: fieldKeys };

  const header = grid[0].map((h) => h.trim().toLowerCase());
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const colFor = (key: string) => {
    let idx = header.indexOf(key.toLowerCase());
    if (idx === -1) idx = header.findIndex((h) => norm(h) === norm(key));
    return idx;
  };

  const cols = new Map<string, number>();
  const missing: string[] = [];
  for (const key of fieldKeys) {
    const idx = colFor(key);
    if (idx === -1) missing.push(key);
    else cols.set(key, idx);
  }

  const rows = grid.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    for (const [key, idx] of cols) rec[key] = (cells[idx] ?? "").trim();
    return rec;
  });
  return { rows, missing };
}

/** Serialize rows of objects into CSV text (columns from the given headers). */
export function toCsv(headers: string[], rows: Record<string, string>[]): string {
  // Neutralize spreadsheet formula injection: a cell that begins with = + - @ (or
  // a tab/CR before them) is executed as a formula by Excel/Sheets, so prefix a
  // single quote. Values here can be attacker-controlled extracted page content.
  const neutralize = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const esc = (v: string) => {
    const s = neutralize(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h] ?? "")).join(","));
  return lines.join("\n");
}
