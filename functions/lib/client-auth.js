const JSON_HEADERS = {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
export function clientJson(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...extra}});}
async function ensureTable(DB){
  await DB.prepare(`CREATE TABLE IF NOT EXISTS client_accounts (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    organisation TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
}
export async function requireClientDB(env){if(!env.DB)throw new Error("DATABASE_UNAVAILABLE");await ensureTable(env.DB);}
function b64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"");}
function unb64(s){const x=s.replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(x+"=".repeat((4-x.length%4)%4)),c=>c.charCodeAt(0));}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:100000},key,256);return b64(new Uint8Array(bits));}
export async function hashClientPassword(password){const salt=crypto.getRandomValues(new Uint8Array(16));return {salt:b64(salt),hash:await passwordHash(password,salt)};}
export async function verifyClientPassword(password,salt,expected){const actual=await passwordHash(password,unb64(salt));const a=new TextEncoder().encode(actual),b=new TextEncoder().encode(expected);let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]||0)^(b[i]||0);return diff===0;}
async function hmacKey(secret){return crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);}
export async function makeClientCookie(accountId,env){const payload=b64(new TextEncoder().encode(JSON.stringify({sub:accountId,exp:Math.floor(Date.now()/1000)+8*3600})));const key=await hmacKey(env.SESSION_SECRET);const sig=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload)));return "evolve_client_session="+payload+"."+b64(sig)+"; Path=/api/client; HttpOnly; Secure; SameSite=Strict; Max-Age=28800";}
export function clearClientCookie(){return "evolve_client_session=; Path=/api/client; HttpOnly; Secure; SameSite=Strict; Max-Age=0";}
export async function clientFromRequest(request,env){if(!env.SESSION_SECRET)return null;const raw=request.headers.get("Cookie")||"";const pair=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith("evolve_client_session="));if(!pair)return null;const parts=pair.slice("evolve_client_session=".length).split(".");if(parts.length!==2)return null;try{const key=await hmacKey(env.SESSION_SECRET);if(!await crypto.subtle.verify("HMAC",key,unb64(parts[1]),new TextEncoder().encode(parts[0])))return null;const p=JSON.parse(new TextDecoder().decode(unb64(parts[0])));if(typeof p.sub!=="string"||!Number.isInteger(p.exp)||p.exp<=Date.now()/1000)return null;return p.sub;}catch{return null;}}
export function validClientEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}
