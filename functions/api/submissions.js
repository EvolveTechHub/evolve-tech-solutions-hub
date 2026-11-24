import { clientFromRequest } from "../lib/client-auth.js";
const MAX_BODY_BYTES = 12_000;
const MAX_FIELD = 4000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function clean(value, max = MAX_FIELD) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return json({ ok: false, message: "The submission service is not configured yet. Please try again later." }, 503);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, message: "Please submit the form using the website." }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, message: "Your submission is too large. Please shorten it and try again." }, 413);
  }

  let payload;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, message: "Your submission is too large." }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ ok: false, message: "The form data could not be read. Please try again." }, 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ ok: false, message: "Please submit a valid form." }, 400);
  }

  // Honeypot: quietly accept automated spam without storing it.
  if (clean(payload.website, 200)) return json({ ok: true, message: "Thank you. Your submission has been received." }, 201);

  const type = clean(payload.type, 30);
  const name = clean(payload.name, 120);
  const email = clean(payload.email, 254).toLowerCase();
  const organisation = clean(payload.organisation, 160);
  const interest = clean(payload.interest, 160);
  const service = clean(payload.service, 160);
  const currency = clean(payload.currency, 8);
  const details = clean(payload.details, 3000);
  const message = clean(payload.message, 4000);
  const consent = payload.privacyConsent === true;

  if (!["enquiry", "registration", "quote", "client_request"].includes(type)) {
    return json({ ok: false, message: "Please select a valid submission type." }, 400);
  }
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, message: "Please provide a valid name and email address." }, 400);
  }
  if (!consent) {
    return json({ ok: false, message: "Please confirm that you have read the Privacy Notice before submitting." }, 400);
  }
  if ((type === "enquiry" || type === "client_request") && (!interest || message.length < 5)) {
    return json({ ok: false, message: "Please choose an area of interest and tell us briefly how we can help." }, 400);
  }
  if (type === "registration" && !interest) {
    return json({ ok: false, message: "Please choose an area of interest." }, 400);
  }
  if (type === "quote" && (!service || !currency)) {
    return json({ ok: false, message: "Please choose a service and budget currency." }, 400);
  }

  try {
    let accountId = null;
    let submittedName = name;
    let submittedEmail = email;
    let submittedOrganisation = organisation;
    if (type === "client_request") {
      const sessionId = await clientFromRequest(request, env);
      if (sessionId) {
        const account = await env.DB.prepare(
          "SELECT id, full_name, email, organisation FROM client_accounts WHERE id = ?"
        ).bind(sessionId).first();
        if (account) {
          accountId = account.id;
          submittedName = account.full_name;
          submittedEmail = account.email;
          submittedOrganisation = account.organisation || organisation;
        }
      }
    }
    await env.DB.prepare(`
      INSERT INTO submissions
        (type, name, email, organisation, interest, service, currency, details, message, created_at, client_account_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Received')
    `).bind(
      type, submittedName, submittedEmail, submittedOrganisation, interest, service, currency,
      details, message, new Date().toISOString(), accountId
    ).run();
    return json({ ok: true, message: "Thank you. Your submission has been received by Evolve." }, 201);
  } catch (error) {
    return json({ ok: false, message: "We could not save your submission just now. Please try again shortly." }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok: false, message: "Use the website form to submit information." }, 405);
}
