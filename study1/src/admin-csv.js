// CSV of the issued links (used by /admin and the tests). RFC 4180 quoting.

const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows, columns) => [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
export const issuedCsv = (rows) => toCsv(rows, ["participant_id", "link"]);
