import {clientJson,makeClientCookie,requireClientDB,validClientEmail,verifyClientPassword} from "../../lib/client-auth.js";
export async function onRequestPost({request,env}){
 if(!env.SESSION_SECRET||!env.DB)return clientJson({ok:false,message:"Client sign-in is not configured."},503);
 if(!request.headers.get("content-type")?.includes("application/json"))return clientJson({ok:false,message:"Invalid request."},415);
 try{const body=await request.json(),email=typeof body.email==="string"?body.email.trim().toLowerCase():"",password=typeof body.password==="string"?body.password:"";if(!validClientEmail(email)||password.length<1||password.length>128)return clientJson({ok:false,message:"Email or password is incorrect."},401);
 await requireClientDB(env);const row=await env.DB.prepare("SELECT id,full_name,email,organisation,password_hash,password_salt FROM client_accounts WHERE email=? COLLATE NOCASE").bind(email).first();
 if(!row||!await verifyClientPassword(password,row.password_salt,row.password_hash))return clientJson({ok:false,message:"Email or password is incorrect."},401);
 return clientJson({ok:true,client:{id:row.id,name:row.full_name,email:row.email,organisation:row.organisation}},200,{"set-cookie":await makeClientCookie(row.id,env)});
 }catch{return clientJson({ok:false,message:"We could not sign you in. Please try again."},500);}
}
