import {clientFromRequest} from "../../lib/client-auth.js";
import {isAuthenticated} from "../../lib/admin-auth.js";
import {ensureProjectFilesTable,fileJson} from "../../lib/project-files.js";
export async function onRequestGet({request,env,params}){
 try{
  if(!env.DB||!env.PROJECT_FILES)return fileJson({ok:false,message:"Project file storage is not configured."},503);
  await ensureProjectFilesTable(env.DB);
  const id=String(params?.id||"").slice(0,80);
  const row=await env.DB.prepare("SELECT * FROM client_project_files WHERE id=?").bind(id).first();
  if(!row)return fileJson({ok:false,message:"File not found."},404);
  const account=await clientFromRequest(request,env),staff=await isAuthenticated(request,env);
  if(!staff&&(!account||account!==row.client_account_id))return fileJson({ok:false,message:"You do not have access to this project file."},403);
  const object=await env.PROJECT_FILES.get(row.storage_key);if(!object)return fileJson({ok:false,message:"The stored file is unavailable."},404);
  const name=String(row.original_name).replace(/["\\\r\n]/g,"_");
  return new Response(object.body,{headers:{"content-type":row.content_type,"content-length":String(row.size_bytes),"content-disposition":'attachment; filename="'+name+'"',"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
 }catch{return fileJson({ok:false,message:"The file could not be downloaded."},500);}
}
