// Temporary owner-operated activation, not part of the permanent Worker entrypoint.
// Never accept a URL, token, owner ID or Telegram method from the caller.
const HOST = "easypws-telegram.yanze.me";
const WEBHOOK = "https://" + HOST + "/webhook";
const BOT = "leo728_easypws_bot";
const SECRET = /^[A-Za-z0-9_-]{32,256}$/;
const ID = /^[1-9][0-9]{0,15}$/;

function reply(status, code) {
  return Response.json({status:code}, {status, headers:{"cache-control":"no-store"}});
}
function equal(a,b) {
  if (typeof a !== "string" || typeof b !== "string" || !SECRET.test(a) || !SECRET.test(b)) return false;
  let diff = a.length ^ b.length;
  for (let i=0; i<Math.max(a.length,b.length); i++) diff |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return diff===0;
}

export async function handleSetup(request, env, telegramFetch = fetch) {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.hostname !== HOST || url.pathname !== "/__setup" || request.method !== "POST" || url.search) return reply(404,"NOT_FOUND");
  if (!equal(request.headers.get("X-EasyPWS-Setup-Secret"), env.TELEGRAM_WEBHOOK_SECRET)) return reply(403,"FORBIDDEN");
  if (!env.DB || typeof env.TELEGRAM_BOT_TOKEN !== "string" || !/^[0-9]{4,}:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN) ||
      !ID.test(env.TELEGRAM_OWNER_USER_ID ?? "") || !ID.test(env.TELEGRAM_OWNER_CHAT_ID ?? "") ||
      env.TELEGRAM_OWNER_USER_ID !== env.TELEGRAM_OWNER_CHAT_ID ||
      !Number.isSafeInteger(Number(env.TELEGRAM_OWNER_USER_ID))) return reply(503,"CONFIG_INVALID");
  // Only controlled error codes cross the owner-authenticated boundary.
  class TelegramFailure extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  const api = async (method, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await telegramFetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
        ...(body === undefined ? {method:"GET"} : {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body)}),
        signal:controller.signal, redirect:"error"
      });
      if (!response.ok) {
        const status = response.status;
        throw new TelegramFailure(Number.isInteger(status) && status >= 400 && status <= 599 ? "HTTP_" + status : "HTTP_ERROR");
      }
      let data;
      try { data = await response.json(); }
      catch { throw new TelegramFailure(controller.signal.aborted ? "TIMEOUT" : "INVALID_JSON"); }
      if (data?.ok !== true) {
        const code = data?.error_code;
        throw new TelegramFailure(Number.isInteger(code) && code >= 400 && code <= 599 ? "API_" + code : "API_ERROR");
      }
      return data.result;
    } catch (error) {
      if (error instanceof TelegramFailure) throw error;
      throw new TelegramFailure(controller.signal.aborted || error?.name === "TimeoutError" || error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_FAILED");
    } finally {
      clearTimeout(timer);
    }
  };
  let stage = "DB";
  try {
    await env.DB.prepare("SELECT COUNT(*) AS n FROM telegram_update_receipts").first();
    stage = "GET_ME";
    const me = await api("getMe");
    if (me?.is_bot !== true || me?.username?.toLowerCase() !== BOT) return reply(409,"BOT_MISMATCH");
    stage = "GET_WEBHOOK_INFO";
    const before = await api("getWebhookInfo");
    if (typeof before?.url !== "string") return reply(502,"WEBHOOK_INFO_INVALID");
    if (before.url === WEBHOOK) return reply(200,"ALREADY_REGISTERED_OWNER_TEST_REQUIRED");
    if (before.url !== "") return reply(409,"OTHER_WEBHOOK_EXISTS");
    stage = "SET_WEBHOOK";
    const result = await api("setWebhook", {url:WEBHOOK,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:["message"],max_connections:1,drop_pending_updates:false});
    if (result !== true) return reply(502,"REGISTER_NOT_CONFIRMED");
    stage = "READBACK";
    const after = await api("getWebhookInfo");
    if (after?.url !== WEBHOOK) return reply(502,"READBACK_MISMATCH");
    return reply(200,"WEBHOOK_REGISTERED_OWNER_TEST_REQUIRED");
  } catch (error) {
    // Do not log exceptions or upstream responses: they may contain credentials.
    return reply(502,stage+"_"+(error instanceof TelegramFailure ? error.code : "FAILED"));
  }
}
