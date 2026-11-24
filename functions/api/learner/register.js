import {hashPassword,makeLearnerCookie,learnerJson,requireLearnerDB,validEmail} from "../../lib/learner-auth.js";
export async function onRequestPost({request,env}){
 if(!env.SESSION_SECRET)return learnerJson({ok:false,message:"Learner accounts are not configured yet."},503);
 if(!env.DB)return learnerJson({ok:false,message:"The learner database is unavailable."},503);
 if(!request.headers.get("content-type")?.includes("application/json"))return learnerJson({ok:false,message:"Invalid request."},415);
 try{
  const body=await request.json(),name=typeof body.name==="string"?body.name.trim().slice(0,120):"",email=typeof body.email==="string"?body.email.trim().toLowerCase().slice(0,254):"",interest=typeof body.interest==="string"?body.interest.trim().slice(0,160):"",password=typeof body.password==="string"?body.password:"";
  if(name.length<2||!validEmail(email))return learnerJson({ok:false,message:"Enter your full name and a valid email address."},400);
  if(password.length<12||password.length>128)return learnerJson({ok:false,message:"Choose a password between 12 and 128 characters."},400);
  await requireLearnerDB(env);const {salt,hash}=await hashPassword(password),id=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO learner_accounts (id,full_name,email,interest,password_hash,password_salt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,name,email,interest,hash,salt,now,now).run();
  return learnerJson({ok:true,message:"Your learner account has been created.",learner:{id,name,email,interest}},201,{"set-cookie":await makeLearnerCookie(id,env)});
 }catch(e){if(String(e).includes("UNIQUE"))return learnerJson({ok:false,message:"An account with this email already exists. Please sign in instead."},409);return learnerJson({ok:false,message:"We could not create your account. Please try again."},500);}
}
