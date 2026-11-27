import {isAuthenticated} from "../../lib/admin-auth.js";
import {ensureProjectFilesTable,validateProjectFile,fileJson,projectFileMetadata} from "../../lib/project-files.js";
const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";
export async function onRequestGet({request,env}){
 try{
  if(!(await isAuthenticated(request,env)))return fileJson({ok:false,message:"Staff sign-in required."},401);
  if(!env.DB)return fileJson({ok:false,message:"Database is not configured."},503);
  await ensureProjectFilesTable(env.DB);
  const projectId=clean(new URL(request.url).searchParams.get("projectId"),80);
  if(!projectId)return fileJson({ok:false,message:"Choose a project."},400);
  const rows=await env.DB.prepare("SELECT * FROM client_project_files WHERE project_id=? ORDER BY created_at DESC LIMIT 100").bind(projectId).all();
  return fileJson({ok:true,files:(rows.results||[]).map(projectFileMetadata)});
 }catch{return fileJson({ok:false,message:"Project files could not be loaded."},500);}
}
export async function onRequestPost({request,env}){
 try{
  if(!(await isAuthenticated(request,env)))return fileJson({ok:false,message:"Staff sign-in required."},401);
  if(!env.DB||!env.PROJECT_FILES)return fileJson({ok:false,message:"Project file storage is not configured."},503);
  await ensureProjectFilesTable(env.DB);
  if(!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data"))return fileJson({ok:false,message:"Use the project upload form."},415);
  const declaredSize=Number(request.headers.get("content-length")||0);if(declaredSize>8*1024*1024+65536)return fileJson({ok:false,message:"Files must not exceed 8 MB."},413);
  const form=await request.formData(),projectId=clean(form.get("projectId"),80),file=form.get("file");
  const project=await env.DB.prepare("SELECT id,client_account_id FROM client_projects WHERE id=?").bind(projectId).first();
  if(!project)return fileJson({ok:false,message:"Project not found."},404);
  const valid=validateProjectFile(file);if(!valid.ok)return fileJson({ok:false,message:valid.message},400);
  const previous=await env.DB.prepare("SELECT COALESCE(MAX(version),0) AS version FROM client_project_files WHERE project_id=? AND original_name=?").bind(projectId,valid.name).first();const version=(previous?.version||0)+1;
  const id=crypto.randomUUID(),key="projects/"+projectId+"/"+id;
  await env.PROJECT_FILES.put(key,file.stream(),{httpMetadata:{contentType:valid.type}});
  const now=new Date().toISOString();
  try{await env.DB.prepare("INSERT INTO client_project_files(id,project_id,client_account_id,uploaded_by,original_name,content_type,size_bytes,storage_key,version,created_at) VALUES(?,?,?,'team',?,?,?,?,?,?)").bind(id,projectId,project.client_account_id,valid.name,valid.type,file.size,key,version,now).run();}
  catch(error){await env.PROJECT_FILES.delete(key);throw error;}
  return fileJson({ok:true,message:"File shared with the client.",file:{id,original_name:valid.name,size_bytes:file.size,version,created_at:now}},201);
 }catch{return fileJson({ok:false,message:"The file could not be uploaded."},500);}
}
