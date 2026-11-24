const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

export function jsonReply(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEADERS, ...extraHeaders }
  });
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function signingKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSession(env) {
  const expires = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ exp: expires })));
  const key = await signingKey(env.SESSION_SECRET);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return { token: payload + "." + base64url(signature), expires };
}

export async function isAuthenticated(request, env) {
  if (!env.SESSION_SECRET) return false;
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookie = cookieHeader.split(";").map(part => part.trim()).find(part => part.startsWith("evolve_admin_session="));
  if (!cookie) return false;
  const token = cookie.slice("evolve_admin_session=".length);
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const key = await signingKey(env.SESSION_SECRET);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64url(parts[1]),
      new TextEncoder().encode(parts[0])
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    return Number.isInteger(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function sessionCookie(token, maxAge = 8 * 60 * 60) {
  return "evolve_admin_session=" + token + "; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}

export function clearSessionCookie() {
  return "evolve_admin_session=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}
