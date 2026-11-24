import {clearClientCookie,clientJson} from "../../lib/client-auth.js";
export async function onRequestPost(){return clientJson({ok:true},200,{"set-cookie":clearClientCookie()});}
