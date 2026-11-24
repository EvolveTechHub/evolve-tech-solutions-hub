import { clearSessionCookie, jsonReply } from "../../lib/admin-auth.js";

export async function onRequestPost() {
  return jsonReply({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "allow": "POST, OPTIONS" } });
}
