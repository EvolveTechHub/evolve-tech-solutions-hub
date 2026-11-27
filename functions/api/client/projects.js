import { clientFromRequest, clientJson, requireClientDB } from "../../lib/client-auth.js";

const MAX_SCOPE = 24000;

async function ensureProjectsTable(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS client_projects (
    id TEXT PRIMARY KEY,
    client_account_id TEXT NOT NULL,
    source_ai_task_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    service TEXT NOT NULL,
    objective TEXT NOT NULL,
    scope_snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Planned',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_client_projects_account_created ON client_projects (client_account_id, created_at DESC)").run();
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function projectTitle(service, objective) {
  const firstLine = clean(objective, 500).split(/[\n.!?]/)[0].trim();
  const suffix = firstLine || "New project";
  return (service + " — " + suffix).slice(0, 160);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB || !env.SESSION_SECRET) return clientJson({ ok: false, message: "Client projects are not configured." }, 503);
    await requireClientDB(env);
    await ensureProjectsTable(env.DB);
    const accountId = await clientFromRequest(request, env);
    if (!accountId) return clientJson({ ok: false, message: "Sign in to view your projects." }, 401);
    const rows = await env.DB.prepare(
      "SELECT id,title,service,objective,status,source_ai_task_id,created_at,updated_at FROM client_projects WHERE client_account_id=? ORDER BY created_at DESC LIMIT 50"
    ).bind(accountId).all();
    return clientJson({ ok: true, projects: rows.results || [] });
  } catch {
    return clientJson({ ok: false, message: "Your projects could not be loaded right now." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.SESSION_SECRET) return clientJson({ ok: false, message: "Client projects are not configured." }, 503);
    if (!request.headers.get("content-type")?.includes("application/json")) return clientJson({ ok: false, message: "Invalid request." }, 415);
    const raw = await request.text();
    if (raw.length > 2000) return clientJson({ ok: false, message: "Invalid project request." }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return clientJson({ ok: false, message: "Please submit a valid project request." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return clientJson({ ok: false, message: "Please submit a valid project request." }, 400);
    if (body.confirmScope !== true) return clientJson({ ok: false, message: "Review and confirm the project scope before creating it." }, 400);
    const taskId = clean(body.taskId, 80);
    if (!taskId) return clientJson({ ok: false, message: "Choose a saved AI task to convert into a project." }, 400);

    await requireClientDB(env);
    await ensureProjectsTable(env.DB);
    const accountId = await clientFromRequest(request, env);
    if (!accountId) return clientJson({ ok: false, message: "Sign in to your Client Account before creating a project." }, 401);

    const task = await env.DB.prepare(
      "SELECT id,service,objective,result FROM client_ai_tasks WHERE id=? AND client_account_id=?"
    ).bind(taskId, accountId).first();
    if (!task) return clientJson({ ok: false, message: "That AI task could not be found in your account." }, 404);

    const existing = await env.DB.prepare(
      "SELECT id,title,service,objective,status,source_ai_task_id,created_at,updated_at FROM client_projects WHERE source_ai_task_id=? AND client_account_id=?"
    ).bind(taskId, accountId).first();
    if (existing) return clientJson({ ok: true, created: false, project: existing, message: "This AI task has already been converted into a project." });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const title = projectTitle(task.service, task.objective);
    const scope = clean(task.result, MAX_SCOPE);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO client_projects (id,client_account_id,source_ai_task_id,title,service,objective,scope_snapshot,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'Planned',?,?)"
    ).bind(id, accountId, task.id, title, task.service, task.objective, scope, now, now).run();
    const project = await env.DB.prepare(
      "SELECT id,title,service,objective,status,source_ai_task_id,created_at,updated_at FROM client_projects WHERE source_ai_task_id=? AND client_account_id=?"
    ).bind(taskId, accountId).first();
    if (!project) return clientJson({ ok: false, message: "The project could not be saved. Please try again." }, 500);
    return clientJson({ ok: true, created: project.id === id, project, message: project.id === id ? "Your project has been created and saved." : "This AI task has already been converted into a project." }, project.id === id ? 201 : 200);
  } catch {
    return clientJson({ ok: false, message: "The project could not be created right now. Please try again." }, 500);
  }
}
