import { clientFromRequest, clientJson } from "../../lib/client-auth.js";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 25000;
const MAX_COLUMNS = 100;
const MAX_CELL = 2000;

function detectDelimiter(text) {
  const first = text.split(/\r\n|\n|\r/).find(line => line.trim() !== "") || "";
  const candidates = [",", ";", "\\t"];
  let best = ",", bestCount = 0;
  for (const delimiter of candidates) {
    let count = 0, quoted = false;
    for (let i = 0; i < first.length; i++) {
      if (first[i] === '"' && first[i + 1] === '"' && quoted) { i++; continue; }
      if (first[i] === '"') quoted = !quoted;
      else if (first[i] === delimiter && !quoted) count++;
    }
    if (count > bestCount) { best = delimiter; bestCount = count; }
  }
  return best;
}

function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new Error("ROW_LIMIT");
    } else cell += ch;
    if (cell.length > MAX_CELL) throw new Error("CELL_LIMIT");
  }
  if (quoted) throw new Error("INVALID_CSV");
  row.push(cell);
  if (row.some(v => v.trim() !== "")) rows.push(row);
  return rows;
}

function numeric(value) {
  if (value.trim() === "") return null;
  const normalized = value.trim().replace(/,/g, "");
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.SESSION_SECRET) return clientJson({ ok: false, message: "Dataset analysis is not configured." }, 503);
    const accountId = await clientFromRequest(request, env);
    if (!accountId) return clientJson({ ok: false, message: "Sign in to your Client Account before analysing a dataset." }, 401);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return clientJson({ ok: false, message: "Choose a CSV file to analyse." }, 400);
    if (!file.name.toLowerCase().endsWith(".csv") || (file.type && !["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"].includes(file.type))) {
      return clientJson({ ok: false, message: "For this first release, upload a CSV file only. Excel support is coming next." }, 415);
    }
    if (file.size < 1 || file.size > MAX_BYTES) return clientJson({ ok: false, message: "The CSV must be between 1 byte and 5 MB." }, 413);
    const text = await file.text();
    if (text.includes("\u0000")) return clientJson({ ok: false, message: "This file does not appear to be a valid text CSV." }, 400);
    let rows;
    try { rows = parseCsv(text.replace(/^\uFEFF/, "")); }
    catch (e) {
      const messages = { ROW_LIMIT: "The dataset exceeds the 25,000-row limit.", CELL_LIMIT: "A cell exceeds the 2,000-character limit.", INVALID_CSV: "The CSV has an unclosed quoted field. Please correct the file and try again." };
      return clientJson({ ok: false, message: messages[e.message] || "The CSV could not be parsed." }, 400);
    }
    if (rows.length < 2) return clientJson({ ok: false, message: "Include a header row and at least one data row." }, 400);
    const headers = rows[0].map((h, i) => (h.trim() || "Column " + (i + 1)).slice(0, 100));
    if (headers.length > MAX_COLUMNS) return clientJson({ ok: false, message: "The dataset exceeds the 100-column limit." }, 400);
    if (new Set(headers.map(h => h.toLowerCase())).size !== headers.length) return clientJson({ ok: false, message: "Column names must be unique. Please rename duplicate headers." }, 400);
    const data = rows.slice(1).map(r => headers.map((_, i) => (r[i] ?? "").trim()));
    const preview = data.slice(0, 8).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
    const columns = headers.map((name, index) => {
      const values = data.map(r => r[index]);
      const nonempty = values.filter(v => v !== "");
      const nums = nonempty.map(numeric);
      const numericCount = nums.filter(v => v !== null).length;
      const isNumeric = nonempty.length > 0 && numericCount / nonempty.length >= 0.9;
      const summary = { name, type: isNumeric ? "numeric" : "categorical / text", missing: values.length - nonempty.length, distinct: new Set(nonempty).size };
      if (isNumeric) {
        const sorted = nums.filter(v => v !== null).sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        summary.numeric = {
          count: sorted.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mean: Number((sum / sorted.length).toFixed(4)),
          median: Number((sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2).toFixed(4))
        };
      } else {
        const counts = new Map();
        for (const v of nonempty) counts.set(v, (counts.get(v) || 0) + 1);
        summary.topValues = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({ value: value.slice(0, 120), count }));
      }
      return summary;
    });
    const seen = new Set();
    let duplicates = 0;
    for (const r of data) { const key = JSON.stringify(r); if (seen.has(key)) duplicates++; else seen.add(key); }
    const numericIndexes = columns.map((c, i) => c.type === "numeric" ? i : -1).filter(i => i >= 0).slice(0, 3);
    const categoryIndex = columns.findIndex((c, i) => c.type !== "numeric" && c.distinct > 1 && c.distinct <= 12 && c.topValues);
    let chartData = null;
    if (categoryIndex >= 0 && numericIndexes.length) {
      const groups = new Map();
      for (const row of data) {
        const label = row[categoryIndex] || "(blank)";
        if (!groups.has(label)) groups.set(label, numericIndexes.map(() => 0));
        numericIndexes.forEach((columnIndex, seriesIndex) => {
          const value = numeric(row[columnIndex]);
          if (value !== null) groups.get(label)[seriesIndex] += value;
        });
      }
      chartData = {
        category: headers[categoryIndex],
        series: numericIndexes.map(i => headers[i]),
        points: [...groups.entries()].slice(0, 12).map(([label, values]) => ({ label: label.slice(0, 60), values: values.map(v => Number(v.toFixed(2))) }))
      };
    }
    return clientJson({
      ok: true,
      analysis: {
        fileName: file.name.slice(0, 160),
        rows: data.length,
        columnCount: headers.length,
        duplicateRows: duplicates,
        preview,
        columnSummaries: columns,
        chartData
      },
      notice: "Analysis was computed from the uploaded CSV in memory. The raw file was not saved. Review column types and data quality before using the results."
    });
  } catch {
    return clientJson({ ok: false, message: "Dataset analysis could not be completed. Please check the CSV and try again." }, 500);
  }
}
