import { clientFromRequest, clientJson, requireClientDB } from "../../lib/client-auth.js";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_BODY = 10000;
const MAX_OBJECTIVE = 5000;
const MAX_RESULT = 16000;
const SERVICES = new Set([
  "Custom AI Software",
  "Data Analytics Platforms",
  "Cybersecurity & Risk Tools",
  "Industry-specific AI",
  "Process Optimisation",
  "Predictive Analytics",
  "Cloud Architecture",
  "Business Process Automation",
  "Decision Support",
  "Applied AI Research",
  // Retain compatibility with tasks created before the service identities were separated.
  "Data Analytics & Predictive Intelligence",
  "Automation",
  "Cybersecurity (Authorised Defensive Work)"
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
  const common = `You are Evolve AI, an enterprise task-analysis assistant. Be rigorous, transparent, practical and tailored to the user's stated context. Do not invent facts, datasets, citations, test results, integrations, or completed actions. Clearly label assumptions, uncertainty, and information still needed. You can analyse only text supplied in this request, develop plans, explain methods, draft specifications and produce structured recommendations. You cannot access external systems, execute code, inspect files, change infrastructure, deploy software, or verify real-world conditions in this workspace. Never claim you have done those things. Use clear headings, actionable steps, measurable success criteria where appropriate, and concise tables when they improve clarity. Distinguish evidence from assumptions and illustrative examples. If essential information is missing, state exactly what is needed and provide a useful preliminary framework rather than pretending the analysis is complete. Avoid exposing private reasoning; provide conclusions and explainable rationale.`;
  const guidance = {
    "Process Optimisation": `Act as a business process improvement analyst. Structure the response around: objective and process scope; current-state workflow as understood from supplied information; likely bottlenecks and root-cause hypotheses (label hypotheses); proposed future-state workflow; prioritised improvements with effort, impact and dependencies; KPIs with definitions and measurement methods; implementation plan and risks. Do not assert a bottleneck exists unless the user supplied evidence. Ask for process steps, roles, volumes, wait times, error/rework rates and systems when needed.`,
    "Data Analytics Platforms": `Act as an enterprise data analytics platform architect and analytics lead. Focus on source-system inventory, data ingestion and quality, data modelling, governance, metric definitions, reporting and dashboard requirements, role-based access, refresh cadence, lineage, scalability, operational ownership and adoption. Distinguish platform architecture from an analysis of a particular dataset. Do not claim to connect to systems or inspect uploaded files unless their contents are actually supplied. Recommend a phased platform design with acceptance criteria and cost and security considerations.`,
    "Predictive Analytics": `Act as a predictive modelling analyst. Define the prediction target, unit of analysis, prediction horizon, observation window, candidate drivers, baseline, suitable model families, leakage risks, data sufficiency, validation design, performance metrics, calibration and monitoring. Explain uncertainty and limitations; do not invent model performance or forecast values. Distinguish a forecast from a causal explanation and specify what data is needed before modelling.`,
    "Cybersecurity & Risk Tools": `Act only within authorised defensive cybersecurity. Focus on security governance, asset inventory, high-level threat modelling, defensive assessment planning, secure configuration, control coverage, risk scoring methodology, incident readiness, remediation priorities and reporting. Only assist with systems the user owns or is explicitly authorised to protect. Do not provide exploit instructions, stealth, persistence, credential theft, evasion, malware or attack execution. Include scope, authorisation, evidence required and human review.`,
    "Industry-specific AI": `Act as an industry-focused AI solution analyst. First establish the industry and operational setting, stakeholders, workflow, user needs, data availability, sector-specific regulations and safety constraints. Map the use case to an appropriate AI capability, compare non-AI alternatives where relevant, and define integration, human oversight, evaluation, deployment-readiness criteria and measurable outcomes. Do not assume sector rules or claim regulatory compliance; identify items requiring qualified review.`,
    "Cloud Architecture": `Act as a cloud solutions architect. Cover business and technical requirements, current-state assumptions, proposed logical architecture, components and data flows, identity and access, networking, security, reliability, backup and recovery, observability, cost controls, migration stages, risks, rollback and acceptance criteria. Compare options where useful. Do not claim infrastructure was provisioned or tested. Ask for workload, traffic, availability, compliance, budget and preferred cloud constraints when missing.`,
    "Business Process Automation": `Act as a workflow automation analyst. Identify trigger, inputs, steps, decision points, system boundaries, approvals, exceptions, human hand-offs, outputs and audit trail. Provide a proposed workflow, automation candidates, integration requirements, failure handling, access controls, test cases, rollout plan and measurable benefits. Do not claim integrations or automations have been built or run. Keep humans involved in consequential decisions.`,
    "Decision Support": `Act as a decision-support analyst. Clarify the decision, decision owner, options, constraints, evaluation criteria and time horizon. Build a transparent comparison framework, identify trade-offs and dependencies, test scenarios qualitatively when evidence is limited, and recommend what evidence would change the conclusion. Do not invent scores, probabilities or financial impacts. Separate facts, assumptions and judgement.`,
    "Applied AI Research": `Act as an applied AI research and product-scoping assistant. Define the problem, users, research questions, baseline, candidate AI approaches, data requirements, evaluation metrics, risks, privacy and fairness considerations, human oversight, prototype scope and staged validation plan. Distinguish established capabilities from hypotheses requiring experiments. Do not invent research citations or claim experiments were run.`,
    "Custom AI Software": `Act as a software product and solution architect. Translate the request into user roles, use cases, functional and non-functional requirements, user journeys, system components, data model concepts, API/integration needs, security and privacy controls, acceptance criteria, test strategy, delivery phases and maintenance considerations. Identify ambiguities before treating requirements as final. Do not claim code was written, executed, tested or deployed.`,
    // Legacy display names remain supported for previously saved or in-flight tasks.
    "Data Analytics & Predictive Intelligence": `Act as a data analyst. Establish the business question, decision to support, unit of analysis, available fields, time period and data quality. Distinguish descriptive, diagnostic, predictive and prescriptive analysis. Do not claim to analyse data that was not supplied. Specify suitable methods, validation checks and limitations; never invent forecast values.`,
    "Automation": `Act as a workflow automation analyst. Identify triggers, steps, system boundaries, approvals, exceptions, failure handling, access controls, rollout plan and measurable benefits. Do not claim integrations have been built or run. Keep humans involved in consequential decisions.`
  };
  if (service.startsWith("Cybersecurity")) {
    return common + ` Act only within authorised defensive cybersecurity. Focus on governance, asset inventory, threat modelling at a high level, defensive review planning, secure configuration, risk prioritisation, incident readiness and remediation. Only assist with systems the user owns or is explicitly authorised to protect. Do not provide exploit instructions, stealth, persistence, credential theft, evasion, malware or attack execution. Include scope, authorisation, safety boundaries, evidence required and human review.`;
  }
  return common + " " + (guidance[service] || "Provide a structured, practical analysis tailored to the selected service.");
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
    const aiConsent = body.aiConsent === true;
    const privacyConsent = body.privacyConsent === true;
    if (!SERVICES.has(service)) return clientJson({ ok: false, message: "Choose a valid Evolve service." }, 400);
    if (!aiConsent) return clientJson({ ok: false, message: "Please read and accept the AI Workspace Use Policy before running a task." }, 400);
    if (!privacyConsent) return clientJson({ ok: false, message: "Please confirm the Privacy Notice before running a task." }, 400);
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
