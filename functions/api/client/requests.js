import {clientFromRequest,clientJson,requireClientDB} from "../../lib/client-auth.js";
export async function onRequestGet({request,env}){
 try{
  if(!env.SESSION_SECRET||!env.DB)return clientJson({ok:false,message:"Client workspace is not configured."},503);
  await requireClientDB(env);
  const id=await clientFromRequest(request,env);
  if(!id)return clientJson({ok:false,message:"Please sign in to view your requests."},401);
  const result=await env.DB.prepare("SELECT id,interest,message,status,created_at FROM submissions WHERE type='client_request' AND client_account_id=? ORDER BY id DESC LIMIT 100").bind(id).all();
  return clientJson({ok:true,requests:result.results||[]});
 }catch{return clientJson({ok:false,message:"Your service requests could not be loaded."},500);}
}