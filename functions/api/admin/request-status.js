import {isAuthenticated,jsonReply} from "../../lib/admin-auth.js";
const allowed=new Set(["Received","Under review","In progress","Awaiting client","Completed","Cancelled"]);
export async function onRequestPost({request,env}){
 try{
  if(!(await isAuthenticated(request,env)))return jsonReply({ok:false,message:"Please sign in to update request status."},401);
  if(!env.DB)return jsonReply({ok:false,message:"Database is not configured."},503);
  const body=await request.json();
  const id=Number(body.id),status=typeof body.status==="string"?body.status:"";
  if(!Number.isSafeInteger(id)||id<1||!allowed.has(status))return jsonReply({ok:false,message:"Choose a valid request and status."},400);
  const result=await env.DB.prepare("UPDATE submissions SET status=? WHERE id=? AND type='client_request'").bind(status,id).run();
  if(!result.meta?.changes)return jsonReply({ok:false,message:"Client request not found."},404);
  return jsonReply({ok:true,message:"Request status updated."});
 }catch{return jsonReply({ok:false,message:"Could not update request status."},500);}
}