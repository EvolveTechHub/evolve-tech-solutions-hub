import {learnerJson,makeLearnerCookie,requireLearnerDB,validEmail,verifyPassword} from "../../lib/learner-auth.js";
export async function onRequestPost({request,env}){
 if(!env.SESSION_SECRET||!env.DB)return learnerJson({ok:false,message:"Learner sign-in is not configured."},503);
 if(!request.headers.get("content-type")?.includes("application/json"))return learnerJson({ok:false,message:"Invalid request."},415);
 try{const body=await request.json(),email=typeof body.email==="string"?body.email.trim().toLowerCase():"",password=typeof body.password==="string"?body.password:"";if(!validEmail(email)||password.length<1||password.length>128)return learnerJson({ok:false,message:"Email or password is incorrect."},401);
 await requireLearnerDB(env);const row=await env.DB.prepare("SELECT id,full_name,email,interest,password_hash,password_salt FROM learner_accounts WHERE email=? COLLATE NOCASE").bind(email).first();
 if(!row||!await verifyPassword(password,row.password_salt,row.password_hash))return learnerJson({ok:false,message:"Email or password is incorrect."},401);
 return learnerJson({ok:true,learner:{id:row.id,name:row.full_name,email:row.email,interest:row.interest}},200,{"set-cookie":await makeLearnerCookie(row.id,env)});
 }catch{return learnerJson({ok:false,message:"We could not sign you in. Please try again."},500);}
}
