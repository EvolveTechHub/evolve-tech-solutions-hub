import { createSession, jsonReply, sessionCookie } from "../../lib/admin-auth.js";

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return jsonReply({ ok: false, message: "Admin login is not configured yet." }, 503);
  }
  if (request.headers.get("content-type")?.includes("application/json") !== true) {
    return jsonReply({ ok: false, message: "Invalid request." }, 415);
  }
  try {
    const body = await request.json();
    const supplied = typeof body.password === "string" ? body.password : "";
    if (supplied.length < 1 || supplied.length > 512) {
      return jsonReply({ ok: false, message: "Incorrect password." }, 401);
    }
    const encoder = new TextEncoder();
    const [providedHash, expectedHash] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
      crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_PASSWORD))
    ]);
    const a = new Uint8Array(providedHash);
    const b = new Uint8Array(expectedHash);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference !== 0) return jsonReply({ ok: false, message: "Incorrect password." }, 401);
    const session = await createSession(env);
    return jsonReply({ ok: true }, 200, { "set-cookie": sessionCookie(session.token) });
  } catch {
    return jsonReply({ ok: false, message: "Unable to sign in. Please try again." }, 400);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "allow": "POST, OPTIONS" } });
}
