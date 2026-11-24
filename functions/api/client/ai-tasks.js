import { clientFromRequest, clientJson, requireClientDB } from "../../lib/client-auth.js";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_BODY = 10000;
const MAX_OBJECTIVE = 5000;
const MAX_RESULT = 16000;
const SERVICES = new Set([
  "Process Optimisation",
  "Data Analytics & Predictive Intelligence",
  "Cloud Architecture",
  "Automation",
  "Decision Support",
  "Applied AI Research",
  "Cybersecurity (Authorised Defensive Work)",
  "Custom AI Software"
]);

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

function systemInstructions(service) {
  const common = `You are Evolve AI, an enterprise task-analysis assistant. Be rigorous, transparent, practical and tailored to the user's stated context. Do not invent facts, datasets, citations, test results, integrations, or completed actions. Clearly label assumptions, uncertainty, and information still needed. You can analyse the text supplied in this request, develop plans, explain methods, draft specifications and produce structured recommendations. You cannot access external systems, execute code, inspect files, change infrastructure, deploy software, or verify real-world conditions in this workspace. Never claim you have done those things. Structure the response with: 1) Understanding of the objective, 2) Analysis and reasoning, 3) Tailored recommendations or proposed deliverable, 4) Assumptions and limitations, 5) Practical next steps. Ask focused clarification questions if the request is too underspecified. Avoid exposing private reasoning; provide concise conclusions and explainable rationale.`;
  if (service.startsWith("Cybersecurity")) {
    return common + " Cybersecurity scope is strictly authorised defensive work. Only assist with systems the user owns or is explicitly authorised to protect. Do not provide exploit instructions, stealth, persistence, credential theft, evasion, or attack execution. Focus on governance, asset inventory, defensive review planning, risk prioritisation, secure configuration and remediation.";
  }
  if (service === "Data Analytics & Predictive Intelligence") {
    return common + " For analytics, do not claim to have analysed a dataset unless its contents were actually supplied in the prompt. State what fields, sample, quality checks and time horizon would be needed. Distinguish descriptive, diagnostic, predictive and prescriptive analysis. Do not present illustrative numbers as measured results.";
  }
  if (service === "Cloud Architecture") {
    return common + " For cloud architecture, address requirements, reliability, security, identity, networking, data protection, cost controls, observability, migration risks and rollback planning. Do not claim infrastructure was provisioned.";
  }
  return common;
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB || !env.SESSION_SECRET) return clientJson({ ok: false, message: "AI workspace is not configured." }, 503);
    await requireClientDB(env);
    await ensureTaskTable(env.DB);
    const accountId = await clientFromRequest(request, env);
    if (!accountId) return clientJson({ ok: false, message: "Please sign in to view AI task history." }, 401);
    const rows = await env.DB.prepare(
      "SELECT id,service,task_mode,objective,result,model,created_at FROM client_ai_tasks WHERE client_account_id=? ORDER BY created_at DESC LIMIT 20"
    ).bind(accountId).all();
    return clientJson({ ok: true, tasks: rows.results || [] });
  } catch {
    return clientJson({ ok: false, message: "AI task history could not be loaded." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.SESSION_SECRET) return clientJson({ ok: false, message: "AI workspace is not configured." }, 503);
    if (!env.AI || typeof env.AI.run !== "function") return clientJson({ ok: false, configured: false, message: "The AI model connection has not been enabled for this Preview environment yet." }, 503);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY) return clientJson({ ok: false, message: "This task is too large. Please shorten it." }, 413);
    const raw = await request.text();
    if (raw.length > MAX_BODY) return clientJson({ ok: false, message: "This task is too large. Please shorten it." }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return clientJson({ ok: false, message: "Please submit a valid task." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return clientJson({ ok: false, message: "Please submit a valid task." }, 400);

    await requireClientDB(env);
    await ensureTaskTable(env.DB);
    const accountId = await clientFromRequest(request, env);
    if (!accountId) return clientJson({ ok: false, message: "Sign in to your Client Account before running an AI task." }, 401);

    const service = clean(body.service, 100);
    const objective = clean(body.objective, MAX_OBJECTIVE);
    const mode = body.mode === "Advanced" ? "Advanced" : "Guided";
    const preferences = clean(body.preferences, 1800);
    if (!SERVICES.has(service)) return clientJson({ ok: false, message: "Choose a valid Evolve service." }, 400);
    if (objective.length < 20) return clientJson({ ok: false, message: "Please provide a little more detail about the task (at least 20 characters)." }, 400);

    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM client_ai_tasks WHERE client_account_id=? AND created_at >= ?"
    ).bind(accountId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).first();
    if ((recent?.total || 0) >= 3) return clientJson({ ok: false, message: "You have reached the initial limit of 3 AI tasks in 24 hours. Please try again later." }, 429);

    const messages = [
      { role: "system", content: systemInstructions(service) },
      { role: "user", content: `Service: ${service}\nTask mode: ${mode}\nUser's task and instructions:\n${objective}\n\nPreferred outputs and constraints:\n${preferences || "Not specified"}\n\nProduce a tailored, useful response within the workspace's stated capabilities. If required inputs are missing, identify them instead of fabricating results.` }
    ];
    const inference = await env.AI.run(MODEL, { messages, max_tokens: 1400, temperature: 0.2 });
    const result = clean(inference?.response, MAX_RESULT);
    if (!result) return clientJson({ ok: false, message: "The AI service did not return a usable result. Please try again." }, 502);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO client_ai_tasks (id,client_account_id,service,task_mode,objective,result,model,created_at) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(id, accountId, service, mode, objective, result, MODEL, createdAt).run();
    return clientJson({ ok: true, task: { id, service, mode, result, model: MODEL, createdAt }, remainingToday: Math.max(0, 2 - (recent?.total || 0)) }, 201);
  } catch {
    return clientJson({ ok: false, message: "The AI task could not be completed right now. Please try again later." }, 500);
  }
}
