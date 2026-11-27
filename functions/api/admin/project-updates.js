import { isAuthenticated, jsonReply } from "../../lib/admin-auth.js";
const STATUSES=new Set(["Planned","In progress","On hold","Under review","Completed","Cancelled"]);
async function ensure(DB){
 await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_updates(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,client_account_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
 await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_activity(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,client_account_id TEXT NOT NULL,event_type TEXT NOT NULL,description TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
}
const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";
export async function onRequestPost({request,env}){
 try{
  if(!(await isAuthenticated(request,env)))return jsonReply({ok:false,message:"Please sign in to manage project updates."},401);
  if(!env.DB)return jsonReply({ok:false,message:"Database is not configured."},503);
  if(!request.headers.get("content-type")?.includes("application/json"))return jsonReply({ok:false,message:"Invalid request."},415);
  const raw=await request.text();if(raw.length>5000)return jsonReply({ok:false,message:"Request is too large."},413);
  let body;try{body=JSON.parse(raw);}catch{return jsonReply({ok:false,message:"Submit valid project details."},400);}
  await ensure(env.DB);
  const projectId=clean(body?.projectId,80);if(!projectId)return jsonReply({ok:false,message:"Choose a project."},400);
  const project=await env.DB.prepare("SELECT id,client_account_id,status FROM client_projects WHERE id=?").bind(projectId).first();
  if(!project)return jsonReply({ok:false,message:"Project not found."},404);
  const now=new Date().toISOString();
  if(body.action==="publish_update"){
   const title=clean(body.title,160),content=clean(body.body,3000);
   if(!title||!content)return jsonReply({ok:false,message:"Enter an update title and details."},400);
   const id=crypto.randomUUID();
   await env.DB.prepare("INSERT INTO client_project_updates(id,project_id,client_account_id,title,body,created_at) VALUES(?,?,?,?,?,?)").bind(id,projectId,project.client_account_id,title,content,now).run();
   await env.DB.prepare("INSERT INTO client_project_activity(id,project_id,client_account_id,event_type,description,created_at) VALUES(?,?,?,'progress_update','Evolve published a project update: '+?,?)").bind(crypto.randomUUID(),projectId,project.client_account_id,title,now).run();
   return jsonReply({ok:true,message:"Project update published to the client.",update:{id,title,body:content,created_at:now}},201);
  }
  if(body.action==="update_status"){
   const status=clean(body.status,30);if(!STATUSES.has(status))return jsonReply({ok:false,message:"Choose a valid project status."},400);
   await env.DB.prepare("UPDATE client_projects SET status=?,updated_at=? WHERE id=?").bind(status,now,projectId).run();
   await env.DB.prepare("INSERT INTO client_project_activity(id,project_id,client_account_id,event_type,description,created_at) VALUES(?,?,?,'project_status','Project status changed to '+?,?)").bind(crypto.randomUUID(),projectId,project.client_account_id,status,now).run();
   return jsonReply({ok:true,message:"Project status updated.",status});
  }
  return jsonReply({ok:false,message:"Unknown project action."},400);
 }catch{return jsonReply({ok:false,message:"The project update could not be saved."},500);}
}
