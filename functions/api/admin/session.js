import { isAuthenticated, jsonReply } from "../../lib/admin-auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return jsonReply({ ok: false, configured: false }, 503);
  }
  const authenticated = await isAuthenticated(request, env);
  return jsonReply({ ok: true, authenticated });
}
