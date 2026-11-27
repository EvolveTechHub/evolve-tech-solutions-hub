import { clientFromRequest, clientJson, requireClientDB } from "../../lib/client-auth.js";

const TASK_STATUSES = new Set(["Not started", "In progress", "Under review", "Completed"]);
const MAX_BODY = 5000;

async function ensureTables(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON client_project_milestones(project_id, sort_order, created_at)").run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_tasks (
    id TEXT PRIMARY KEY,
    milestone_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Not started',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_tasks_milestone ON client_project_tasks(milestone_id, created_at)").run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_activity (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, client_account_id TEXT NOT NULL,
    event_type TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL
  )`).run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_activity_project ON client_project_activity(project_id,created_at DESC)").run();
}
async function recordActivity(DB,projectId,accountId,eventType,description,now){
  await DB.prepare("INSERT INTO client_project_activity(id,project_id,client_account_id,event_type,description,created_at) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),projectId,accountId,eventType,description,now).run();
}
const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";

async function ownedProject(DB, projectId, accountId) {
  return DB.prepare("SELECT id FROM client_projects WHERE id=? AND client_account_id=?").bind(projectId,accountId).first();
}

export async function onRequestGet({request,env}) {
  try {
    if(!env.DB||!env.SESSION_SECRET) return clientJson({ok:false,message:"Project planning is not configured."},503);
    await requireClientDB(env); await ensureTables(env.DB);
    const accountId=await clientFromRequest(request,env);
    if(!accountId) return clientJson({ok:false,message:"Sign in to view project plans."},401);
    const projectId=clean(new URL(request.url).searchParams.get("projectId"),80);
    if(!projectId||!await ownedProject(env.DB,projectId,accountId)) return clientJson({ok:false,message:"Project not found in your account."},404);
    const milestones=await env.DB.prepare("SELECT id,project_id,title,description,sort_order,created_at,updated_at FROM client_project_milestones WHERE project_id=? ORDER BY sort_order,created_at").bind(projectId).all();
    const tasks=await env.DB.prepare("SELECT t.id,t.milestone_id,t.title,t.description,t.status,t.created_at,t.updated_at FROM client_project_tasks t JOIN client_project_milestones m ON m.id=t.milestone_id WHERE m.project_id=? ORDER BY t.created_at").bind(projectId).all();
    return clientJson({ok:true,milestones:milestones.results||[],tasks:tasks.results||[]});
  } catch { return clientJson({ok:false,message:"Project planning details could not be loaded."},500); }
}

export async function onRequestPost({request,env}) {
  try {
    if(!env.DB||!env.SESSION_SECRET) return clientJson({ok:false,message:"Project planning is not configured."},503);
    if(!request.headers.get("content-type")?.includes("application/json")) return clientJson({ok:false,message:"Invalid request."},415);
    const raw=await request.text(); if(raw.length>MAX_BODY) return clientJson({ok:false,message:"Request is too large."},413);
    let body; try{body=JSON.parse(raw);}catch{return clientJson({ok:false,message:"Submit valid project details."},400);}
    if(!body||typeof body!=="object"||Array.isArray(body)) return clientJson({ok:false,message:"Submit valid project details."},400);
    await requireClientDB(env); await ensureTables(env.DB);
    const accountId=await clientFromRequest(request,env);
    if(!accountId) return clientJson({ok:false,message:"Sign in to update project plans."},401);
    const projectId=clean(body.projectId,80);
    if(!projectId||!await ownedProject(env.DB,projectId,accountId)) return clientJson({ok:false,message:"Project not found in your account."},404);
    const action=clean(body.action,40), now=new Date().toISOString();

    if(action==="create_milestone"){
      const title=clean(body.title,140),description=clean(body.description,1000);
      if(!title) return clientJson({ok:false,message:"Enter a milestone title."},400);
      const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM client_project_milestones WHERE project_id=?").bind(projectId).first();
      if((count?.n||0)>=30) return clientJson({ok:false,message:"A project can have up to 30 milestones."},400);
      const id=crypto.randomUUID();
      await env.DB.prepare("INSERT INTO client_project_milestones(id,project_id,title,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id,projectId,title,description,count?.n||0,now,now).run();
      await recordActivity(env.DB,projectId,accountId,"milestone_created","Milestone added: "+title,now);
      return clientJson({ok:true,milestone:{id,title,description}},201);
    }
    if(action==="create_task"){
      const milestoneId=clean(body.milestoneId,80),title=clean(body.title,140),description=clean(body.description,1000);
      const milestone=await env.DB.prepare("SELECT id FROM client_project_milestones WHERE id=? AND project_id=?").bind(milestoneId,projectId).first();
      if(!milestone) return clientJson({ok:false,message:"Milestone not found in this project."},404);
      if(!title) return clientJson({ok:false,message:"Enter a task title."},400);
      const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM client_project_tasks WHERE milestone_id=?").bind(milestoneId).first();
      if((count?.n||0)>=100) return clientJson({ok:false,message:"A milestone can have up to 100 tasks."},400);
      const id=crypto.randomUUID();
      await env.DB.prepare("INSERT INTO client_project_tasks(id,milestone_id,title,description,status,created_at,updated_at) VALUES(?,?,?,?, 'Not started',?,?)").bind(id,milestoneId,title,description,now,now).run();
      await recordActivity(env.DB,projectId,accountId,"task_created","Task added: "+title,now);
      return clientJson({ok:true,task:{id,milestone_id:milestoneId,title,description,status:"Not started"}},201);
    }
    if(action==="update_task"){
      const taskId=clean(body.taskId,80),status=clean(body.status,30);
      if(!TASK_STATUSES.has(status)) return clientJson({ok:false,message:"Choose a valid task status."},400);
      const task=await env.DB.prepare("SELECT t.id FROM client_project_tasks t JOIN client_project_milestones m ON m.id=t.milestone_id WHERE t.id=? AND m.project_id=?").bind(taskId,projectId).first();
      if(!task) return clientJson({ok:false,message:"Task not found in this project."},404);
      await env.DB.prepare("UPDATE client_project_tasks SET status=?,updated_at=? WHERE id=?").bind(status,now,taskId).run();
      await recordActivity(env.DB,projectId,accountId,"task_status_changed","Task status changed to "+status+".",now);
      return clientJson({ok:true,message:"Task status updated."});
    }
    return clientJson({ok:false,message:"Unknown project action."},400);
  } catch { return clientJson({ok:false,message:"Your project update could not be saved. Please try again."},500); }
}
