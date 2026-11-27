import {clientFromRequest,requireClientDB} from "../../lib/client-auth.js";
import {ensureProjectFilesTable,validateProjectFile,MAX_PROJECT_FILE_BYTES,fileJson,projectFileMetadata} from "../../lib/project-files.js";
const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";
export async function onRequestGet({request,env}){
 try{
  if(!env.DB||!env.PROJECT_FILES)return fileJson({ok:false,message:"Project file storage is not configured. Please contact Evolve."},503);
  await requireClientDB(env);await ensureProjectFilesTable(env.DB);
  const account=await clientFromRequest(request,env);if(!account)return fileJson({ok:false,message:"Sign in to view project files."},401);
  const projectId=clean(new URL(request.url).searchParams.get("projectId"),80);
  const project=await env.DB.prepare("SELECT id FROM client_projects WHERE id=? AND client_account_id=?").bind(projectId,account).first();
  if(!project)return fileJson({ok:false,message:"Project not found."},404);
  const rows=await env.DB.prepare("SELECT * FROM client_project_files WHERE project_id=? AND client_account_id=? ORDER BY created_at DESC LIMIT 100").bind(projectId,account).all();
  return fileJson({ok:true,files:(rows.results||[]).map(projectFileMetadata)});
 }catch{return fileJson({ok:false,message:"Project files could not be loaded."},500);}
}
export async function onRequestPost({request,env}){
 try{
  if(!env.DB||!env.PROJECT_FILES)return fileJson({ok:false,message:"Project file storage is not configured. Please contact Evolve."},503);
  await requireClientDB(env);await ensureProjectFilesTable(env.DB);
  const account=await clientFromRequest(request,env);if(!account)return fileJson({ok:false,message:"Sign in to upload project files."},401);
  if(!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data"))return fileJson({ok:false,message:"Upload a file using the project upload form."},415);
  const declaredSize=Number(request.headers.get("content-length")||0);if(declaredSize>8*1024*1024+65536)return fileJson({ok:false,message:"Files must not exceed 8 MB."},413);
  const form=await request.formData(),projectId=clean(form.get("projectId"),80),file=form.get("file");
  const project=await env.DB.prepare("SELECT id FROM client_projects WHERE id=? AND client_account_id=?").bind(projectId,account).first();
  if(!project)return fileJson({ok:false,message:"Project not found."},404);
  const valid=validateProjectFile(file);if(!valid.ok)return fileJson({ok:false,message:valid.message},400);
  const previous=await env.DB.prepare("SELECT COALESCE(MAX(version),0) AS version FROM client_project_files WHERE project_id=? AND original_name=? AND client_account_id=?").bind(projectId,valid.name,account).first();const version=(previous?.version||0)+1;
  const id=crypto.randomUUID(),key="projects/"+projectId+"/"+id;
  await env.PROJECT_FILES.put(key,file.stream(),{httpMetadata:{contentType:valid.type}});
  const now=new Date().toISOString();
  try{await env.DB.prepare("INSERT INTO client_project_files(id,project_id,client_account_id,uploaded_by,original_name,content_type,size_bytes,storage_key,version,created_at) VALUES(?,?,?,'client',?,?,?,?,?,?)").bind(id,projectId,account,valid.name,valid.type,file.size,key,version,now).run();}
  catch(error){await env.PROJECT_FILES.delete(key);throw error;}
  return fileJson({ok:true,message:"File uploaded to this project.",file:{id,original_name:valid.name,size_bytes:file.size,version,created_at:now}},201);
 }catch{return fileJson({ok:false,message:"The file could not be uploaded. Check the file size and try again."},500);}
}
