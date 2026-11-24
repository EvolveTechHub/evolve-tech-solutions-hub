import { isAuthenticated, jsonReply } from "../../lib/admin-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!(await isAuthenticated(request, env))) {
      return jsonReply({ ok: false, message: "Please sign in to view admin records." }, 401);
    }
    if (!env.DB) return jsonReply({ ok: false, message: "The database connection is not configured." }, 503);

    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const allowedTypes = ["registration", "enquiry", "quote"];
    if (type && !allowedTypes.includes(type)) return jsonReply({ ok: false, message: "Invalid record filter." }, 400);

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
    return jsonReply({ ok: true, records: result.results || [], count: (result.results || []).length });
  } catch {
    return jsonReply({ ok: false, message: "The admin records could not be loaded. Please try again." }, 500);
  }
}
