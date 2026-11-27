import { isAuthenticated, jsonReply } from "../../lib/admin-auth.js";

export async function onRequestGet({request,env}){
 try{
  if(!(await isAuthenticated(request,env)))return jsonReply({ok:false,message:"Please sign in to view client projects."},401);
  if(!env.DB)return jsonReply({ok:false,message:"Database is not configured."},503);
  const rows=await env.DB.prepare(`SELECT p.id,p.title,p.service,p.status,p.created_at,a.full_name AS client_name,a.email AS client_email
   FROM client_projects p JOIN client_accounts a ON a.id=p.client_account_id
   ORDER BY p.updated_at DESC LIMIT 200`).all();
  return jsonReply({ok:true,projects:rows.results||[]});
 }catch{return jsonReply({ok:false,message:"Client projects could not be loaded."},500);}
}
