import { isAuthenticated, jsonReply } from "../../lib/admin-auth.js";

async function ensureTables(DB){
 await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_messages (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,client_account_id TEXT NOT NULL,
  sender_type TEXT NOT NULL DEFAULT 'client',message TEXT NOT NULL,created_at TEXT NOT NULL
 )`).run();
 await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_activity (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,client_account_id TEXT NOT NULL,
  event_type TEXT NOT NULL,description TEXT NOT NULL,created_at TEXT NOT NULL
 )`).run();
}
const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";

export async function onRequestGet({request,env}){
 try{
  if(!(await isAuthenticated(request,env)))return jsonReply({ok:false,message:"Please sign in to view project messages."},401);
  if(!env.DB)return jsonReply({ok:false,message:"Database is not configured."},503);
  await ensureTables(env.DB);
  const projectId=clean(new URL(request.url).searchParams.get("projectId"),80);
  if(!projectId)return jsonReply({ok:false,message:"Choose a project."},400);
  const project=await env.DB.prepare("SELECT id,title,client_account_id FROM client_projects WHERE id=?").bind(projectId).first();
  if(!project)return jsonReply({ok:false,message:"Project not found."},404);
  const rows=await env.DB.prepare("SELECT id,sender_type,message,created_at FROM client_project_messages WHERE project_id=? ORDER BY created_at ASC LIMIT 200").bind(projectId).all();
  return jsonReply({ok:true,project,messages:rows.results||[]});
 }catch{return jsonReply({ok:false,message:"Project messages could not be loaded."},500);}
}

export async function onRequestPost({request,env}){
 try{
  if(!(await isAuthenticated(request,env)))return jsonReply({ok:false,message:"Please sign in to reply to project messages."},401);
  if(!env.DB)return jsonReply({ok:false,message:"Database is not configured."},503);
  if(!request.headers.get("content-type")?.includes("application/json"))return jsonReply({ok:false,message:"Invalid request."},415);
  const raw=await request.text();if(raw.length>5000)return jsonReply({ok:false,message:"Reply is too large."},413);
  let body;try{body=JSON.parse(raw);}catch{return jsonReply({ok:false,message:"Submit a valid reply."},400);}
  await ensureTables(env.DB);
  const projectId=clean(body?.projectId,80),message=clean(body?.message,3000);
  if(!projectId||!message)return jsonReply({ok:false,message:"Choose a project and enter a reply."},400);
  const project=await env.DB.prepare("SELECT id,client_account_id FROM client_projects WHERE id=?").bind(projectId).first();
  if(!project)return jsonReply({ok:false,message:"Project not found."},404);
  const now=new Date().toISOString(),id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO client_project_messages(id,project_id,client_account_id,sender_type,message,created_at) VALUES(?,?,?,'team',?,?)").bind(id,projectId,project.client_account_id,message,now).run();
  await env.DB.prepare("INSERT INTO client_project_activity(id,project_id,client_account_id,event_type,description,created_at) VALUES(?,?,?,'team_reply','Evolve team posted a project reply.',?)").bind(crypto.randomUUID(),projectId,project.client_account_id,now).run();
  return jsonReply({ok:true,message:"Reply sent to the client.",sent:{id,created_at:now}},201);
 }catch{return jsonReply({ok:false,message:"The project reply could not be sent."},500);}
}
