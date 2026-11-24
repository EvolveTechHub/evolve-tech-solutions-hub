import { isAuthenticated, jsonReply } from "../../lib/admin-auth.js";
export async function onRequestGet({request,env}){
  try{
    if(!(await isAuthenticated(request,env)))return jsonReply({ok:false,message:"Please sign in to view AI task records."},401);
    if(!env.DB)return jsonReply({ok:false,message:"Database is not configured."},503);
    const result=await env.DB.prepare(`
      SELECT t.id,t.service,t.task_mode,t.objective,t.result,t.model,t.created_at,
             c.full_name,c.email,c.organisation
      FROM client_ai_tasks t
      LEFT JOIN client_accounts c ON c.id=t.client_account_id
      ORDER BY t.created_at DESC LIMIT 100
    `).all();
    return jsonReply({ok:true,tasks:result.results||[]});
  }catch{return jsonReply({ok:false,message:"AI task records could not be loaded."},500);}
}
