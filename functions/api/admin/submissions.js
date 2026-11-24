const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function verifyAccessToken(token, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAIL) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch {
    return false;
  }

  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}.cloudflareaccess.com`;
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (header.alg !== "RS256" || !header.kid || claims.iss !== issuer ||
      !audiences.includes(env.ACCESS_AUD) || !claims.exp || claims.exp <= now ||
      (claims.nbf && claims.nbf > now) ||
      String(claims.email || "").toLowerCase() !== String(env.ADMIN_EMAIL).toLowerCase()) return false;

  const certResponse = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { "accept": "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!certResponse.ok) return false;
  const certs = await certResponse.json();
  const jwk = (certs.keys || []).find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) return false;

  const publicKey = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, decodeBase64Url(parts[2]), signed);
}

export async function onRequestGet({ request, env }) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  try {
    if (!(await verifyAccessToken(token, env))) {
      return reply({ ok: false, message: "Access denied. Sign in through the authorized Evolve staff access page." }, 401);
    }
    if (!env.DB) return reply({ ok: false, message: "The database connection is not configured." }, 503);

    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const allowedTypes = ["registration", "enquiry", "quote"];
    if (type && !allowedTypes.includes(type)) return reply({ ok: false, message: "Invalid record filter." }, 400);

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 250);
    let query = "SELECT id, type, name, email, organisation, interest, service, currency, details, message, created_at FROM submissions";
    const bindings = [];
    if (type) {
      query += " WHERE type = ?";
      bindings.push(type);
    }
    query += " ORDER BY id DESC LIMIT ?";
    bindings.push(limit);

    const result = await env.DB.prepare(query).bind(...bindings).all();
    return reply({ ok: true, records: result.results || [], count: (result.results || []).length });
  } catch {
    return reply({ ok: false, message: "The admin records could not be loaded. Please try again." }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...JSON_HEADERS, "allow": "GET, OPTIONS" } });
}
