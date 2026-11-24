import {hashClientPassword,makeClientCookie,clientJson,requireClientDB,validClientEmail} from "../../lib/client-auth.js";
export async function onRequestPost({request,env}){
 if(!env.SESSION_SECRET||!env.DB)return clientJson({ok:false,message:"Client accounts are not configured yet."},503);
 if(!request.headers.get("content-type")?.includes("application/json"))return clientJson({ok:false,message:"Invalid request."},415);
 try{
  const body=await request.json(),name=typeof body.name==="string"?body.name.trim().slice(0,120):"",email=typeof body.email==="string"?body.email.trim().toLowerCase().slice(0,254):"",organisation=typeof body.organisation==="string"?body.organisation.trim().slice(0,160):"",password=typeof body.password==="string"?body.password:"";
  if(name.length<2||!validClientEmail(email))return clientJson({ok:false,message:"Enter your full name and a valid email address."},400);
  if(body.privacyConsent!==true)return clientJson({ok:false,message:"Please confirm the Privacy Notice before creating your account."},400);
  if(password.length<12||password.length>128)return clientJson({ok:false,message:"Choose a password between 12 and 128 characters."},400);
  await requireClientDB(env);const {salt,hash}=await hashClientPassword(password),id=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO client_accounts (id,full_name,email,organisation,password_hash,password_salt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,name,email,organisation,hash,salt,now,now).run();
  return clientJson({ok:true,message:"Your client account has been created.",client:{id,name,email,organisation}},201,{"set-cookie":await makeClientCookie(id,env)});
 }catch(e){
  console.error("Client registration failure:",e?.name||"Error",e?.message||"Unknown error");
  if(String(e).includes("UNIQUE"))return clientJson({ok:false,message:"An account with this email already exists. Please sign in instead."},409);
  return clientJson({ok:false,message:"We could not create your account. Please try again."},500);
 }
}
