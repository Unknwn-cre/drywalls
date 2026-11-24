// Worker "drywalls" (drywall installation, Loutraki): serves site/ as static assets, 301s other hostnames to SITE_URL when REDIRECT is "on",
// handles POST /api/lead from the quote form, and runs the owner's offers app under /prosfores/ (offers/store.js).
// A lead goes to every channel configured with variables (Worker → Settings → Variables and Secrets), same as gutters-toronto:
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  → Telegram message (simplest; several chat ids separated by commas)
//   RESEND_API_KEY + LEAD_EMAIL_TO (+ LEAD_EMAIL_FROM) → email via resend.com
//   LEAD_WEBHOOK_URL                       → JSON POST (Zapier, Make, Google Sheets…)
//   LEAD_TO                                → email through Cloudflare Email Routing (binding LEAD; destination must be verified)
// With no channel configured the form answers "failed", and the page offers WhatsApp/Viber/email with the same text.
import { EmailMessage } from "cloudflare:email";
import { Store, BASE as OFFERS } from "./offers/store.js";

// Durable Object of the offers app (gypsos-loutraki.com/prosfores/): PIN, works catalogue, prices, saved offers.
export { Store };

const FROM = "form@gypsos-loutraki.com";
const MAX_FIELD = 2000;
// The pages are built with this placeholder address. When the PUBLIC_EMAIL variable is set in the Worker
// (Settings → Variables and Secrets), every HTML page and app.js is served with that address instead.
const SITE_EMAIL = "info@gypsos-loutraki.com";

async function withEmail(res, env) {
  const to = (env.PUBLIC_EMAIL || "").trim();
  const type = res.headers.get("Content-Type") || "";
  if (!to || to === SITE_EMAIL || (res.status !== 200 && res.status !== 404) ||!/text\/html|javascript/.test(type)) return res;
  const body = (await res.text()).split(SITE_EMAIL).join(to);
  const headers = new Headers(res.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = new URL(env.SITE_URL);
    if (env.REDIRECT === "on" && url.hostname !== site.hostname && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      // one address for Google: the old workers.dev address and www. are moved permanently to SITE_URL
      return Response.redirect(site.origin + url.pathname + url.search, 301);
    }
    if (url.pathname === OFFERS || url.pathname.startsWith(OFFERS + "/")) return offers(request, env, url);
    if (url.pathname !== "/api/lead") return withEmail(await env.ASSETS.fetch(request), env);
    if (request.method !== "POST") return json({ success: false, message: "POST only" }, 405);
    const origin = request.headers.get("Origin");
    if (origin && new URL(origin).hostname !== url.hostname) return json({ success: false, message: "bad origin" }, 403);

    let form;
    try { form = await request.formData(); } catch { return json({ success: false, message: "bad form" }, 400); }
    const fields = [];
    for (const [k, v] of form) {
      const value = String(v).trim().slice(0, MAX_FIELD);
      if (!k.startsWith("_") && value) fields.push([k.slice(0, 50), value]);
    }
    const get = (k) => (fields.find((f) => f[0] === k) || [])[1] || "";
    if (form.get("_honey")) return json({ success: true });
    if (!get("Όνομα") || !get("Τηλέφωνο")) return json({ success: false, message: "name and phone required" }, 400);

    const subject = "Νέα αίτηση (γυψοσανίδες Λουτράκι): " + get("Όνομα") + (get("Γλώσσα") === "English" ? " (English)" : "");
    const text = fields.map(([k, v]) => k + ": " + v).join("\n") + "\n";
    const replyTo = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(get("Email")) ? get("Email") : "";

    const jobs = [];
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) jobs.push(sendTelegram(env, subject, text));
    if (env.RESEND_API_KEY && env.LEAD_EMAIL_TO) jobs.push(sendResend(env, subject, text, replyTo));
    if (env.LEAD_WEBHOOK_URL) jobs.push(sendWebhook(env, fields));
    if (env.LEAD_TO && env.LEAD) jobs.push(sendRouting(env, subject, text, replyTo));
    if (!jobs.length) {
      console.error("lead: no delivery channel configured");
      return json({ success: false, message: "no delivery channel" }, 500);
    }
    const results = await Promise.allSettled(jobs);
    results.filter((r) => r.status === "rejected").forEach((r) => console.error("lead delivery failed:", r.reason && r.reason.message));
    // one working channel is enough
    if (!results.some((r) => r.status === "fulfilled")) return json({ success: false, message: "send failed" }, 502);
    return json({ success: true });
  },
};

// Offers app: its API goes to the one Durable Object, its files come from site/prosfores/; nothing there is indexed.
async function offers(request, env, url) {
  const res = url.pathname.startsWith(OFFERS + "/api/")
    ? await env.STORE.get(env.STORE.idFromName("main")).fetch(request)
    : await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  return out;
}

async function check(res, label) {
  if (!res.ok) throw new Error(label + " " + res.status + ": " + (await res.text()).slice(0, 300));
}

// TELEGRAM_CHAT_ID may list several chats separated by commas (e.g. "123456789,987654321");
// each person must first press Start in the bot. One delivered copy counts as success.
async function sendTelegram(env, subject, text) {
  const ids = String(env.TELEGRAM_CHAT_ID).split(",").map((x) => x.trim()).filter(Boolean);
  const results = await Promise.allSettled(ids.map(async (id) => {
    const res = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, text: "🧱 " + subject + "\n\n" + text }),
    });
    await check(res, "telegram " + id);
  }));
  results.filter((r) => r.status === "rejected").forEach((r) => console.error("lead delivery failed:", r.reason && r.reason.message));
  if (!results.some((r) => r.status === "fulfilled")) throw new Error("telegram: no chat received the lead");
}

async function sendResend(env, subject, text, replyTo) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.LEAD_EMAIL_FROM || "Website leads <onboarding@resend.dev>",
      to: env.LEAD_EMAIL_TO.split(",").map((x) => x.trim()),
      reply_to: replyTo || undefined,
      subject,
      text,
    }),
  });
  await check(res, "resend");
}

async function sendWebhook(env, fields) {
  const res = await fetch(env.LEAD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(fields.concat([["received", new Date().toISOString()]]))),
  });
  await check(res, "webhook");
}

async function sendRouting(env, subject, text, replyTo) {
  const TO = env.LEAD_TO;
  const headers = [
    "From: =?UTF-8?B?" + b64("Γυψοσανίδες Λουτράκι (site)") + "?= <" + FROM + ">",
    "To: <" + TO + ">",
    replyTo && "Reply-To: <" + replyTo + ">",
    "Subject: =?UTF-8?B?" + b64(subject) + "?=",
    "Date: " + new Date().toUTCString(),
    "Message-ID: <" + crypto.randomUUID() + "@gypsos-loutraki.com>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const raw = headers.join("\r\n") + "\r\n\r\n" + b64(text).replace(/.{76}/g, "$&\r\n");
  await env.LEAD.send(new EmailMessage(FROM, TO, raw));
}

function b64(s) {
  let bin = "";
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
