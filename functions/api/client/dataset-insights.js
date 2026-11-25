import { clientFromRequest, clientJson, requireClientDB } from "../../lib/client-auth.js";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_RESULT = 12000;

async function ensureTaskTable(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS client_ai_tasks (
    id TEXT PRIMARY KEY,
    client_account_id TEXT NOT NULL,
    service TEXT NOT NULL,
    task_mode TEXT NOT NULL,
    objective TEXT NOT NULL,
    result TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_client_ai_tasks_account_created ON client_ai_tasks (client_account_id, created_at DESC)").run();
}
function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.SESSION_SECRET) return clientJson({ ok: false, message: "AI workspace is not configured." }, 503);
    if (!env.AI || typeof env.AI.run !== "function") return clientJson({ ok: false, message: "The AI model connection is not enabled in this Preview environment." }, 503);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 12000) return clientJson({ ok: false, message: "The analysis summary is too large." }, 413);
    let body;
    try { body = await request.json(); } catch { return clientJson({ ok: false, message: "Submit a valid analysis summary." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return clientJson({ ok: false, message: "Submit a valid analysis summary." }, 400);
    if (body.aiConsent !== true || body.privacyConsent !== true) return clientJson({ ok: false, message: "Please confirm both workspace policies before generating AI insights." }, 400);
    await requireClientDB(env);
    await ensureTaskTable(env.DB);
    const accountId = await clientFromRequest(request, env);
    if (!accountId) return clientJson({ ok: false, message: "Sign in to your Client Account before generating insights." }, 401);
    const analysis = body.analysis;
    if (!analysis || !Array.isArray(analysis.columnSummaries) || analysis.columnSummaries.length < 1 || analysis.columnSummaries.length > 100) {
      return clientJson({ ok: false, message: "Run the CSV descriptive analysis first." }, 400);
    }
    const summaries = analysis.columnSummaries.map(c => {
      const item = { name: clean(c.name, 100), type: clean(c.type, 40), missing: Number(c.missing) || 0, distinct: Number(c.distinct) || 0 };
      if (c.numeric && typeof c.numeric === "object") {
        item.numeric = {};
        for (const key of ["count", "min", "max", "mean", "median"]) {
          const n = Number(c.numeric[key]);
          if (Number.isFinite(n)) item.numeric[key] = n;
        }
      }
      if (Array.isArray(c.topValues)) item.topValues = c.topValues.slice(0, 5).map(v => ({ value: clean(v.value, 80), count: Number(v.count) || 0 }));
      return item;
    });
    const safeAnalysis = {
      rowCount: Math.max(0, Math.min(25000, Number(analysis.rows) || 0)),
      columnCount: summaries.length,
      duplicateRows: Math.max(0, Math.min(25000, Number(analysis.duplicateRows) || 0)),
      columns: summaries,
      categoryBreakdown: analysis.chartData && Array.isArray(analysis.chartData.points)
        ? (() => {
            const metrics = Array.isArray(analysis.chartData.series) ? analysis.chartData.series.slice(0, 3).map(x => clean(x, 100)) : [];
            const points = analysis.chartData.points.slice(0, 12).map(point => {
              const records = Math.max(0, Math.min(25000, Number(point.count) || 0));
              const totals = Array.isArray(point.values) ? point.values.slice(0, 3).map(v => Number.isFinite(Number(v)) ? Number(v) : 0) : [];
              return {
                label: clean(point.label, 60),
                records,
                totals,
                averagesPerRecord: totals.map(value => records > 0 ? Number((value / records).toFixed(4)) : null)
              };
            });
            const rankings = metrics.map((metric, index) => {
              const ordered = [...points].sort((a, b) => (b.totals[index] || 0) - (a.totals[index] || 0));
              return {
                metric,
                highestTotal: ordered[0]?.label || null,
                highestValue: ordered[0]?.totals[index] ?? null,
                lowestTotal: ordered[ordered.length - 1]?.label || null,
                lowestValue: ordered[ordered.length - 1]?.totals[index] ?? null,
                orderedTotals: ordered.map(point => ({ category: point.label, total: point.totals[index] || 0 }))
              };
            });
            const verifiedFindings = rankings.map(ranking =>
              ranking.metric + " totals, highest to lowest: " +
              ranking.orderedTotals.map(item => item.category + " (" + item.total + ")").join("; ") +
              ". Highest: " + ranking.highestTotal + " (" + ranking.highestValue + "). Lowest: " +
              ranking.lowestTotal + " (" + ranking.lowestValue + ")."
            );
            return { category: clean(analysis.chartData.category, 100), metrics, points, rankings, verifiedFindings };
          })()
        : null,
      timeTrend: analysis.trendData && Array.isArray(analysis.trendData.points)
        ? {
            dateColumn: clean(analysis.trendData.dateColumn, 100),
            granularity: analysis.trendData.granularity === "month" ? "month" : "day",
            excludedRows: Math.max(0, Math.min(25000, Number(analysis.trendData.excludedRows) || 0)),
            metrics: Array.isArray(analysis.trendData.series) ? analysis.trendData.series.slice(0, 3).map(x => clean(x, 100)) : [],
            points: analysis.trendData.points.slice(-120).map(point => ({
              date: clean(point.date, 20),
              records: Math.max(0, Math.min(25000, Number(point.count) || 0)),
              totals: Array.isArray(point.values) ? point.values.slice(0, 3).map(v => Number.isFinite(Number(v)) ? Number(v) : 0) : []
            }))
          }
        : null
    };
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM client_ai_tasks WHERE client_account_id=? AND created_at >= ?"
    ).bind(accountId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).first();
    if ((recent?.total || 0) >= 3) return clientJson({ ok: false, message: "You have reached the initial limit of 3 AI tasks in 24 hours. Please try again later." }, 429);

    const messages = [
      { role: "system", content: "You are Evolve AI, a careful business data analyst. Interpret only the supplied aggregate statistics. You have not seen the raw dataset and must not imply otherwise. Do not invent trends over time, correlations, causal effects, forecasts, customer characteristics, or business outcomes that the summary cannot support. If timeTrend is supplied, describe only the observed date-grouped totals, state whether grouping is daily or monthly, mention excluded undated rows, and identify increases or decreases only when directly visible in the supplied points. Do not call this a forecast. Distinguish observed statistics from hypotheses and recommendations. Explicitly mention the small sample size when row count is below 30. Explain that top category counts are record frequencies, not metric totals. If categoryBreakdown is supplied, interpret every metric separately. The categoryBreakdown.verifiedFindings and orderedTotals are backend-computed authoritative rankings; reproduce their ordering and values exactly, and never contradict them. Do not independently guess or recalculate rankings from memory. If verifiedFindings says a category is not the lowest for a metric, do not call it the lowest. Never describe a category as having low overall performance merely because it ranks low on one metric. Explicitly distinguish total values from averages per record; averages per record are descriptive and do not establish conversion rates or causal relationships. For example, a category may have fewer enquiries but still have higher sales totals than another category; state both facts accurately. Never infer that a column named Sales is monetary revenue, units sold, or profit unless its meaning and units are provided. If a ratio is discussed, label it as a simple aggregate ratio and warn that it is not necessarily a conversion rate because the rows may not represent matched enquiry-to-sale journeys. Provide headings: 1) What the summary shows, 2) Category-level totals, 3) Data quality and limitations, 4) Useful business questions, 5) Recommended next analyses, 6) Practical actions. Include a separate time-trend interpretation in the relevant sections when timeTrend is available; otherwise say no reliable date trend was supplied. Use concise, specific language and explain when a conclusion cannot be drawn." },
      { role: "user", content: "Analyse these aggregate-only CSV statistics for a business user. Do not request or assume raw records.\n" + JSON.stringify(safeAnalysis) }
    ];
    const inference = await env.AI.run(MODEL, { messages, max_tokens: 1100, temperature: 0.15 });
    const result = clean(inference?.response, MAX_RESULT);
    if (!result) return clientJson({ ok: false, message: "The AI service did not return a usable insight report." }, 502);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO client_ai_tasks (id,client_account_id,service,task_mode,objective,result,model,created_at) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(id, accountId, "Data Analytics & Predictive Intelligence", "Dataset Insights", "AI interpretation of aggregate CSV statistics", result, MODEL, createdAt).run();
    return clientJson({ ok: true, result, model: MODEL, createdAt, remainingToday: Math.max(0, 2 - (recent?.total || 0)) }, 201);
  } catch {
    return clientJson({ ok: false, message: "AI dataset insights could not be generated. Please try again later." }, 500);
  }
}
