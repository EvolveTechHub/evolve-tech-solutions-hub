const ALLOWED=new Map([
 ["pdf",["application/pdf"]],["txt",["text/plain"]],["csv",["text/csv","application/vnd.ms-excel"]],
 ["docx",["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
 ["xlsx",["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
 ["pptx",["application/vnd.openxmlformats-officedocument.presentationml.presentation"]],
 ["png",["image/png"]],["jpg",["image/jpeg"]],["jpeg",["image/jpeg"]]
]);
export const MAX_PROJECT_FILE_BYTES=8*1024*1024;
export function safeProjectFilename(name){return String(name||"file").normalize("NFKC").replace(/[^a-zA-Z0-9._ -]/g,"_").replace(/[. ]+$/g,"").slice(0,120)||"file";}
export function validateProjectFile(file){
 const name=safeProjectFilename(file?.name),ext=name.split(".").pop().toLowerCase(),type=String(file?.type||"application/octet-stream").toLowerCase();
 if(!ALLOWED.has(ext)||!ALLOWED.get(ext).includes(type))return {ok:false,message:"File type not supported. Use PDF, TXT, CSV, DOCX, XLSX, PPTX, PNG or JPG."};
 if(!file.size||file.size>MAX_PROJECT_FILE_BYTES)return {ok:false,message:"Files must be between 1 byte and 8 MB."};
 return {ok:true,name,type};
}
export async function ensureProjectFilesTable(DB){
 await DB.prepare(`CREATE TABLE IF NOT EXISTS client_project_files(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL,client_account_id TEXT NOT NULL,
 uploaded_by TEXT NOT NULL,original_name TEXT NOT NULL,content_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL,storage_key TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
 )`).run();
 await DB.prepare("CREATE INDEX IF NOT EXISTS idx_project_files_project ON client_project_files(project_id,created_at DESC)").run();
}
export function fileJson(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
export function projectFileMetadata(row){return {id:row.id,project_id:row.project_id,uploaded_by:row.uploaded_by,original_name:row.original_name,content_type:row.content_type,size_bytes:row.size_bytes,version:row.version,created_at:row.created_at};}
