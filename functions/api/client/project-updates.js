import { clientFromRequest, clientJson, requireClientDB } from "../../lib/client-auth.js";
async function ensure(DB){
 await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_updates(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,client_account_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
 await DB.prepare("CREATE INDEX IF NOT EXISTS idx_client_project_updates ON client_project_updates(project_id,created_at DESC)").run();
 await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_reads(project_id TEXT NOT NULL,client_account_id TEXT NOT NULL,last_seen_at TEXT NOT NULL,PRIMARY KEY(project_id,client_account_id))`).run();
 await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_activity(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,client_account_id TEXT NOT NULL,event_type TEXT NOT NULL,description TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
}
const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";
async function owned(DB,id,account){return DB.prepare("SELECT id FROM client_projects WHERE id=? AND client_account_id=?").bind(id,account).first();}
export async function onRequestGet({request,env}){
 try{
  if(!env.DB||!env.SESSION_SECRET)return clientJson({ok:false,message:"Project updates are not configured."},503);
  await requireClientDB(env);await ensure(env.DB);
  const account=await clientFromRequest(request,env);if(!account)return clientJson({ok:false,message:"Sign in to view project updates."},401);
  const projectId=clean(new URL(request.url).searchParams.get("projectId"),80);
  if(projectId&&!await owned(env.DB,projectId,account))return clientJson({ok:false,message:"Project not found."},404);
  const sql=`SELECT p.id AS project_id,p.title AS project_title,
   (SELECT COUNT(*) FROM client_project_updates u WHERE u.project_id=p.id AND u.client_account_id=p.client_account_id AND u.created_at>COALESCE((SELECT last_seen_at FROM client_project_reads r WHERE r.project_id=p.id AND r.client_account_id=p.client_account_id),'1970-01-01T00:00:00.000Z')) AS unread_updates,
   (SELECT COUNT(*) FROM client_project_messages m WHERE m.project_id=p.id AND m.client_account_id=p.client_account_id AND m.sender_type='team' AND m.created_at>COALESCE((SELECT last_seen_at FROM client_project_reads r WHERE r.project_id=p.id AND r.client_account_id=p.client_account_id),'1970-01-01T00:00:00.000Z')) AS unread_messages
   FROM client_projects p WHERE p.client_account_id=? ${projectId?"AND p.id=?":""} ORDER BY p.created_at DESC`;
  const rows=await env.DB.prepare(sql).bind(...(projectId?[account,projectId]:[account])).all();
  let updates=[];
  if(projectId){const result=await env.DB.prepare("SELECT id,title,body,created_at FROM client_project_updates WHERE project_id=? AND client_account_id=? ORDER BY created_at DESC LIMIT 100").bind(projectId,account).all();updates=result.results||[];}
  return clientJson({ok:true,projects:rows.results||[],updates});
 }catch{return clientJson({ok:false,message:"Project updates could not be loaded."},500);}
}
export async function onRequestPost({request,env}){
 try{
  if(!env.DB||!env.SESSION_SECRET)return clientJson({ok:false,message:"Project updates are not configured."},503);
  if(!request.headers.get("content-type")?.includes("application/json"))return clientJson({ok:false,message:"Invalid request."},415);
  const raw=await request.text();if(raw.length>1500)return clientJson({ok:false,message:"Invalid request."},413);
  let body;try{body=JSON.parse(raw);}catch{return clientJson({ok:false,message:"Submit a valid request."},400);}
  await requireClientDB(env);await ensure(env.DB);
  const account=await clientFromRequest(request,env);if(!account)return clientJson({ok:false,message:"Sign in to update read status."},401);
  const projectId=clean(body?.projectId,80);if(!projectId||!await owned(env.DB,projectId,account))return clientJson({ok:false,message:"Project not found."},404);
  if(body.action!=="mark_read")return clientJson({ok:false,message:"Unknown action."},400);
  const now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO client_project_reads(project_id,client_account_id,last_seen_at) VALUES(?,?,?) ON CONFLICT(project_id,client_account_id) DO UPDATE SET last_seen_at=excluded.last_seen_at").bind(projectId,account,now).run();
  return clientJson({ok:true,last_seen_at:now});
 }catch{return clientJson({ok:false,message:"Read status could not be saved."},500);}
}
