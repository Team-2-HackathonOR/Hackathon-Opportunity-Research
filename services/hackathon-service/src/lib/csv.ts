export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "";
    }
    const text =
      typeof value === "string"
        ? value
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(","));
  }
  return lines.join("\n");
}
