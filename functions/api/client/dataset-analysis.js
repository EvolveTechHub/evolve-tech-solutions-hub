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

function dateKey(value) {
  const v = String(value || "").trim();
  // Accept spreadsheet exports that stringify a year as 2026.0, without treating other decimals as dates.
  m = v.match(/^(\d{4})(?:\.0+)?[-/.](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    const d = new Date(Date.UTC(y, month - 1, day));
    if (d.getUTCFullYear() === y && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) return d.toISOString().slice(0, 10);
  }
  m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    const month = a > 12 ? b : b > 12 ? a : 0;
    const day = a > 12 ? a : b > 12 ? b : 0;
    if (month && day) {
      const d = new Date(Date.UTC(y, month - 1, day));
      if (d.getUTCFullYear() === y && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) return d.toISOString().slice(0, 10);
    }
  }
  m = v.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]), month = Number(m[2]);
    if (month >= 1 && month <= 12) return String(y).padStart(4, "0") + "-" + String(month).padStart(2, "0");
  }
  return null;
}

function numeric(value) {
  if (value.trim() === "") return null;
  const normalized = value.trim().replace(/,/g, "");
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}


function linearFit(values) {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0, denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  const slope = denominator ? numerator / denominator : 0;
  return { intercept: meanY - slope * meanX, slope, predict: x => meanY - slope * meanX + slope * x };
}

function nextPeriod(label, granularity, steps) {
  const parts = label.split("-").map(Number);
  if (granularity === "month") {
    const date = new Date(Date.UTC(parts[0], parts[1] - 1 + steps, 1));
    return date.toISOString().slice(0, 7);
  }
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + steps));
  return date.toISOString().slice(0, 10);
}

function buildForecast(trendData) {
  const minimumPeriods = 24;
  const holdout = 6;
  if (!trendData || !Array.isArray(trendData.points) || !Array.isArray(trendData.series)) {
    return { status: "unavailable", reason: "A recognised date column and numeric metric are required." };
  }
  const points = trendData.points;
  if (trendData.datePrecisionMixed) {
    return { status: "insufficient_data", periodsAvailable: points.length, minimumPeriods,
      reason: "The date column mixes month-only and full-date values. Use one consistent date format before forecasting." };
  }
  if (trendData.excludedRows > 0) {
    return { status: "insufficient_data", periodsAvailable: points.length, minimumPeriods,
      reason: trendData.excludedRows + " rows have unrecognised dates. Correct or remove those rows before forecasting so the historical series is complete." };
  }
  if (points.length < minimumPeriods) {
    return { status: "insufficient_data", periodsAvailable: points.length, minimumPeriods,
      reason: "At least 24 consecutive dated periods are required. This provides a longer history and six rolling validation periods." };
  }
  const regular = points.every((point, index) => index === 0 || nextPeriod(points[index - 1].date, trendData.granularity, 1) === point.date);
  if (!regular) {
    return { status: "insufficient_data", periodsAvailable: points.length, minimumPeriods,
      reason: "The detected dates contain gaps. This baseline requires consecutive daily or monthly periods; review missing periods before forecasting." };
  }
  const metrics = trendData.series.slice(0, 3).map((name, metricIndex) => {
    if (points.some(point => !Array.isArray(point.validCounts) || point.validCounts[metricIndex] !== point.count)) {
      return { metric: name, status: "unavailable", reason: "At least one period contains missing or invalid values for this metric. Complete the metric data before forecasting." };
    }
    const values = points.map(point => Number(point.values[metricIndex]));
    if (values.length !== points.length || values.some(value => !Number.isFinite(value))) {
      return { metric: name, status: "unavailable", reason: "Some periods have missing or invalid metric values." };
    }
    const trendErrors = [], naiveErrors = [];
    for (let index = values.length - holdout; index < values.length; index++) {
      const training = values.slice(0, index);
      const observed = values[index];
      const fit = linearFit(training);
      trendErrors.push(observed - fit.predict(training.length));
      naiveErrors.push(observed - training[training.length - 1]);
    }
    const mae = errors => errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
    const trendMae = mae(trendErrors);
    const naiveMae = mae(naiveErrors);
    const useTrend = trendMae < naiveMae && trendMae <= naiveMae * 0.9;
    const selectedModel = useTrend ? "Linear trend" : "Last-period baseline";
    const selectedErrors = useTrend ? trendErrors : naiveErrors;
    const selectedMae = useTrend ? trendMae : naiveMae;
    const denominator = values.slice(-holdout).reduce((sum, value) => sum + Math.abs(value), 0);
    const wapePercent = denominator > 0
      ? Number((selectedErrors.reduce((sum, error) => sum + Math.abs(error), 0) / denominator * 100).toFixed(2))
      : null;
    const validationRmse = Math.sqrt(selectedErrors.reduce((sum, error) => sum + error * error, 0) / selectedErrors.length);
    const fullFit = linearFit(values);
    const forecast = [1, 2, 3].map(step => {
      const raw = useTrend ? fullFit.predict(values.length - 1 + step) : values[values.length - 1];
      const estimate = Math.max(0, raw);
      const band = 1.96 * validationRmse * Math.sqrt(step);
      return {
        period: nextPeriod(points[points.length - 1].date, trendData.granularity, step),
        estimate: Number(estimate.toFixed(2)),
        lower: Number(Math.max(0, estimate - band).toFixed(2)),
        upper: Number((estimate + band).toFixed(2))
      };
    });
    const quality = wapePercent === null ? "not_assessed"
      : wapePercent <= 20 ? "lower_validation_error"
      : wapePercent <= 35 ? "moderate_validation_error" : "high_validation_error";
    return {
      metric: name,
      status: "available",
      model: selectedModel,
      quality,
      validation: {
        holdoutPeriods: holdout,
        method: "Rolling-origin one-step-ahead validation",
        trendMae: Number(trendMae.toFixed(2)),
        naiveMae: Number(naiveMae.toFixed(2)),
        selectedMae: Number(selectedMae.toFixed(2)),
        skillVsNaivePercent: naiveMae > 0 ? Number(((naiveMae - selectedMae) / naiveMae * 100).toFixed(2)) : null,
        wapePercent,
        validationRmse: Number(validationRmse.toFixed(2))
      },
      forecasts: forecast,
      uncertaintyNote: "Indicative ranges are based on six rolling out-of-sample validation errors and widen with forecast horizon. They are not formal prediction intervals or guaranteed limits."
    };
  });
  return {
    status: "available",
    method: "Three-period baseline forecast selected by six-period rolling-origin validation",
    granularity: trendData.granularity,
    historicalPeriods: points.length,
    validationPeriods: holdout,
    minimumPeriods,
    metrics
  };
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
    const categoryCandidates = columns.map((c, i) => ({ c, i })).filter(x => x.c.type !== "numeric" && x.c.distinct > 1 && x.c.distinct <= 12 && x.c.topValues);
    const categoryIndex = (categoryCandidates.find(x => /product|category|type|region|channel|segment|status/i.test(x.c.name) && !/date|time|year|month/i.test(x.c.name)) || categoryCandidates.find(x => !/date|time|year|month/i.test(x.c.name)) || categoryCandidates[0])?.i ?? -1;
    let chartData = null;
    if (categoryIndex >= 0 && numericIndexes.length) {
      const groups = new Map();
      for (const row of data) {
        const label = row[categoryIndex] || "(blank)";
        if (!groups.has(label)) groups.set(label, { count: 0, sums: numericIndexes.map(() => 0) });
        const group = groups.get(label);
        group.count++;
        numericIndexes.forEach((columnIndex, seriesIndex) => {
          const value = numeric(row[columnIndex]);
          if (value !== null) group.sums[seriesIndex] += value;
        });
      }
      chartData = {
        category: headers[categoryIndex],
        series: numericIndexes.map(i => headers[i]),
        points: [...groups.entries()].slice(0, 12).map(([label, group]) => ({
          label: label.slice(0, 60),
          count: group.count,
          values: group.sums.map(v => Number(v.toFixed(2)))
        }))
      };
    }
    let trendData = null;
    const dateCandidates = columns.map((c, i) => ({ c, i })).filter(x => x.c.type !== "numeric");
    let dateChoice = null, dateValues = null, bestDateRatio = 0;
    for (const candidate of dateCandidates) {
      const parsed = data.map(row => dateKey(row[candidate.i]));
      const valid = parsed.filter(Boolean).length;
      const ratio = data.length ? valid / data.length : 0;
      const named = /date|time|day|month/i.test(candidate.c.name);
      if (ratio >= 0.8 && (named || ratio > bestDateRatio)) {
        dateChoice = candidate; dateValues = parsed; bestDateRatio = ratio;
        if (named && ratio >= 0.8) break;
      }
    }
    if (dateChoice && numericIndexes.length) {
      const datedRows = data.map((row, i) => ({ key: dateValues[i], row })).filter(x => x.key);
      const datePrecisionMixed = datedRows.some(item => item.key.length !== datedRows[0].key.length);
      const monthOnly = datedRows.length > 0 && datedRows.every(item => item.key.length === 7);
      const granularity = monthOnly ? "month" : "day";
      const groups = new Map();
      for (const item of datedRows) {
        const key = granularity === "month" ? item.key.slice(0, 7) : item.key;
        if (!groups.has(key)) groups.set(key, { count: 0, sums: numericIndexes.map(() => 0), validCounts: numericIndexes.map(() => 0) });
        const group = groups.get(key);
        group.count++;
        numericIndexes.forEach((columnIndex, seriesIndex) => {
          const value = numeric(item.row[columnIndex]);
          if (value !== null) {
            group.sums[seriesIndex] += value;
            group.validCounts[seriesIndex]++;
          }
        });
      }
      trendData = {
        dateColumn: dateChoice.c.name,
        granularity,
        datePrecisionMixed,
        excludedRows: data.length - datedRows.length,
        series: numericIndexes.map(i => headers[i]),
        points: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-240).map(([date, group]) => ({
          date, count: group.count, values: group.sums.map(v => Number(v.toFixed(2))), validCounts: group.validCounts
        }))
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
        chartData,
        trendData,
        forecastData: buildForecast(trendData)
      },
      notice: "Analysis was computed from the uploaded CSV in memory. The raw file was not saved. Review column types and data quality before using the results."
    });
  } catch {
    return clientJson({ ok: false, message: "Dataset analysis could not be completed. Please check the CSV and try again." }, 500);
  }
}
