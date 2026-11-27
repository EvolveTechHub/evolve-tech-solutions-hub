import { clientFromRequest, clientJson, requireClientDB } from "../../lib/client-auth.js";

async function ensureTables(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_messages (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, client_account_id TEXT NOT NULL,
    sender_type TEXT NOT NULL DEFAULT 'client', message TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_messages_project ON client_project_messages(project_id,created_at)").run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_activity (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, client_account_id TEXT NOT NULL,
    event_type TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL
  )`).run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_activity_project ON client_project_activity(project_id,created_at DESC)").run();
}
const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";
async function owned(DB,id,account){return DB.prepare("SELECT id FROM client_projects WHERE id=? AND client_account_id=?").bind(id,account).first();}

export async function onRequestGet({request,env}) {
 try {
  if(!env.DB||!env.SESSION_SECRET)return clientJson({ok:false,message:"Project collaboration is not configured."},503);
  await requireClientDB(env);await ensureTables(env.DB);
  const account=await clientFromRequest(request,env);if(!account)return clientJson({ok:false,message:"Sign in to view project conversations."},401);
  const projectId=clean(new URL(request.url).searchParams.get("projectId"),80);
  if(!projectId||!await owned(env.DB,projectId,account))return clientJson({ok:false,message:"Project not found in your account."},404);
  const [messages,activity]=await Promise.all([
   env.DB.prepare("SELECT id,sender_type,message,created_at FROM client_project_messages WHERE project_id=? AND client_account_id=? ORDER BY created_at DESC LIMIT 100").bind(projectId,account).all(),
   env.DB.prepare("SELECT id,event_type,description,created_at FROM client_project_activity WHERE project_id=? AND client_account_id=? ORDER BY created_at DESC LIMIT 100").bind(projectId,account).all()
  ]);
  return clientJson({ok:true,messages:messages.results||[],activity:activity.results||[]});
 }catch{return clientJson({ok:false,message:"Project collaboration could not be loaded."},500);}
}

export async function onRequestPost({request,env}) {
 try {
  if(!env.DB||!env.SESSION_SECRET)return clientJson({ok:false,message:"Project collaboration is not configured."},503);
  if(!request.headers.get("content-type")?.includes("application/json"))return clientJson({ok:false,message:"Invalid request."},415);
  const raw=await request.text();if(raw.length>5000)return clientJson({ok:false,message:"Message is too large."},413);
  let body;try{body=JSON.parse(raw);}catch{return clientJson({ok:false,message:"Submit a valid message."},400);}
  if(!body||typeof body!=="object"||Array.isArray(body))return clientJson({ok:false,message:"Submit a valid message."},400);
  await requireClientDB(env);await ensureTables(env.DB);
  const account=await clientFromRequest(request,env);if(!account)return clientJson({ok:false,message:"Sign in to message Evolve."},401);
  const projectId=clean(body.projectId,80);
  if(!projectId||!await owned(env.DB,projectId,account))return clientJson({ok:false,message:"Project not found in your account."},404);
  const message=clean(body.message,3000);if(!message)return clientJson({ok:false,message:"Write a message before sending."},400);
  const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM client_project_messages WHERE client_account_id=? AND created_at>?").bind(account,new Date(Date.now()-60000).toISOString()).first();
  if((recent?.n||0)>=8)return clientJson({ok:false,message:"Please wait before sending another message."},429);
  const id=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO client_project_messages(id,project_id,client_account_id,sender_type,message,created_at) VALUES(?,?,?,'client',?,?)").bind(id,projectId,account,message,now).run();
  await env.DB.prepare("INSERT INTO client_project_activity(id,project_id,client_account_id,event_type,description,created_at) VALUES(?,?,?,'message_sent','Client sent a project message.',?)").bind(crypto.randomUUID(),projectId,account,now).run();
  return clientJson({ok:true,message:"Your message has been sent to Evolve.",sent:{id,created_at:now}},201);
 }catch{return clientJson({ok:false,message:"Your message could not be sent. Please try again."},500);}
}
