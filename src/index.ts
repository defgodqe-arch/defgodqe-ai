import { Env, ChatMessage } from "./types";

const CHAT_MODEL = "alibaba/qwen3.5-397b-a17b";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const TTS_MODEL = "@cf/deepgram/aura-2-en";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_BODY_BYTES = 120_000;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_TOKENS = 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const usage = { requests: 0, chat: 0, web: 0, vision: 0, image: 0, tts: 0, errors: 0, started: Date.now() };
const SYSTEM_PROMPT = `You are defgodqe, an advanced AI assistant.\nYour name is defgodqe.\nNever claim to be ChatGPT or another AI.\nYour tagline is "Your AI. Your Ideas. Your World.".\nBe helpful, accurate, creative, concise and honest.\nNever fabricate facts, sources, URLs, actions or files.\nWhen giving code, make it complete and runnable whenever practical.`;
const rateBuckets = new Map<string, { count: number; reset: number }>();
function corsHeaders(request?: Request): HeadersInit {
  const origin = request?.headers.get("Origin");
  // GitHub Pages and the standalone worker UI are cross-origin clients.
  // This API does not use cookies, so wildcard access is appropriate.
  const allowedOrigin = origin && (origin === "https://defgodqe-arch.github.io" || origin === "https://ai.defgodqe.workers.dev" || origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173") ? origin : "*";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, X-Defgodqe-Client, X-Turnstile-Token",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}
function json(data: unknown, status = 200, extra: HeadersInit = {}, request?: Request) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(request), ...extra } }); }
function getClientKey(request: Request) { return request.headers.get("X-Defgodqe-Client") || "anonymous"; }
function checkRateLimit(request: Request) { const key = getClientKey(request), now = Date.now(), existing = rateBuckets.get(key); if (!existing || existing.reset <= now) { rateBuckets.set(key, { count: 1, reset: now + RATE_WINDOW_MS }); return { ok: true, retryAfter: 0 }; } existing.count += 1; if (existing.count > RATE_LIMIT) return { ok: false, retryAfter: Math.ceil((existing.reset - now) / 1000) }; return { ok: true, retryAfter: 0 }; }
function validateRequest(request: Request, maxBytes = MAX_BODY_BYTES) { const contentLength = Number(request.headers.get("content-length") || 0); return contentLength > maxBytes ? "Request body is too large." : null; }
function normalizeMessages(value: unknown): ChatMessage[] { if (!Array.isArray(value)) return []; return value.slice(-MAX_MESSAGES).map((message: any) => ({ role: message?.role, content: String(message?.content || "").slice(0, MAX_MESSAGE_CHARS) })).filter((message): message is ChatMessage => (message.role === "system" || message.role === "user" || message.role === "assistant") && Boolean(message.content)); }
function baseHeaders() { return { ...corsHeaders(), "cache-control": "no-cache, no-store, must-revalidate" }; }
function extractText(value: any): string { if (!value) return ""; if (typeof value === "string") return value; if (typeof value.output_text === "string") return value.output_text; if (typeof value.response === "string") return value.response; if (typeof value.text === "string") return value.text; if (Array.isArray(value.output)) for (const item of value.output) { const found = extractText(item); if (found) return found; } if (Array.isArray(value.content)) for (const item of value.content) { const found = extractText(item); if (found) return found; } return ""; }
function extractSources(value: any) { const results: Array<{ title: string; url: string; domain: string }> = [], seen = new Set<string>(); function visit(node: any) { if (!node || results.length >= 8) return; if (Array.isArray(node)) { for (const item of node) visit(item); return; } if (typeof node !== "object") return; for (const annotation of Array.isArray(node.annotations) ? node.annotations : []) { if (annotation?.type !== "url_citation") continue; const url = String(annotation?.url || annotation?.citation?.url || "").trim(); if (!/^https?:\/\//i.test(url) || seen.has(url)) continue; seen.add(url); let domain = ""; try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch {} results.push({ title: String(annotation?.title || annotation?.citation?.title || domain || url), url, domain }); } for (const [key, child] of Object.entries(node)) if (key !== "annotations") visit(child); } visit(value); return results; }
export { DefGameRoom } from "./game-room";
export default { async fetch(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const url = new URL(request.url);
  if (url.pathname === "/game") return handleGame(request, env);
  if (url.pathname === "/") return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  if (url.pathname === "/voice-studio.html" || url.pathname === "/voice-studio.js") return env.ASSETS.fetch(new Request(new URL(url.pathname, request.url), request));
  if (url.pathname === "/usage" && request.method === "GET") return json({ success: true, uptimeSeconds: Math.floor((Date.now() - usage.started) / 1000), ...usage, rateLimit: RATE_LIMIT });
  if (!["/chat", "/web-search", "/generate-image", "/vision", "/tts", "/studio/tts"].includes(url.pathname)) return json({ success: false, error: "Not found" }, 404, {}, request);
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405, {}, request);
  const validationError = validateRequest(request, url.pathname === "/studio/tts" ? 18_000_000 : MAX_BODY_BYTES); if (validationError) return json({ success: false, error: validationError }, 413, {}, request);
  const rate = checkRateLimit(request); if (!rate.ok) return json({ success: false, error: "Too many requests. Please slow down.", retryAfter: rate.retryAfter }, 429, { "retry-after": String(rate.retryAfter) }, request);
  usage.requests++;
  try { if (url.pathname === "/chat") { usage.chat++; return await handleChat(request, env, url.searchParams.get("stream") === "1"); } if (url.pathname === "/web-search") { usage.web++; return await handleWebSearch(request, env); } if (url.pathname === "/vision") { usage.vision++; return await handleVision(request, env); } if (url.pathname === "/tts") { usage.tts++; return await handleTts(request, env); } if (url.pathname === "/studio/tts") { usage.tts++; return await handleDramaStudio(request, env); } usage.image++; return await handleImage(request, env); } catch (error) { usage.errors++; console.error("defgodqe worker error", error); return json({ success: false, error: "The AI service encountered an internal error." }, 500, {}, request); }
} } satisfies ExportedHandler<Env>;
function handleGame(request: Request, env: Env): Promise<Response> | Response { if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return env.ASSETS.fetch(new Request(new URL("/game.html", request.url), request)); const url = new URL(request.url); const supplied = (url.searchParams.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); const room = supplied || crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase(); url.searchParams.set("room", room); const id = env.GAME_ROOMS.idFromName(room); return env.GAME_ROOMS.get(id).fetch(new Request(url.toString(), request)); }
async function handleChat(request: Request, env: Env, stream: boolean) {
  const body = (await request.json()) as { messages?: unknown };
  const messages = normalizeMessages(body.messages);
  if (!messages.length) return json({ success: false, error: "At least one message is required." }, 400, {}, request);
  if (!messages.some((message) => message.role === "system")) messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  // Try the configured model first, then stable Workers AI models if it is unavailable
  // in this account/region. This prevents a retired or unsupported model ID from
  // taking the whole chat endpoint down.
  const candidates = [...new Set([CHAT_MODEL, "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct"])];
  let result: any = null;
  let lastError: unknown = null;
  for (const model of candidates) {
    try {
      result = await env.AI.run(model, { messages, max_tokens: MAX_TOKENS, temperature: 0.65, top_p: 0.9, stream } as any);
      if (result) break;
    } catch (error) {
      lastError = error;
      console.error("Workers AI model failed", model, error);
    }
  }
  if (!result) {
    const detail = lastError instanceof Error ? lastError.message.slice(0, 240) : "No model returned a response.";
    return json({ success: false, error: "AI inference failed. " + detail }, 502, {}, request);
  }
  if (stream) return new Response(result as ReadableStream, { status: 200, headers: { ...corsHeaders(request), "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive" } });
  const response = extractText(result) || String(result?.response || "");
  if (!response) return json({ success: false, error: "The AI model returned an empty response." }, 502, {}, request);
  return json({ success: true, response }, 200, {}, request);
}
async function handleWebSearch(request: Request, env: Env) { const body = (await request.json()) as { query?: unknown }, query = String(body.query || "").trim().slice(0, 4000); if (!query) return json({ success: false, error: "A search query is required." }, 400); const result = await env.AI.run("openai/gpt-4o-mini", { input: `Search the live web for this query and answer accurately: ${query}\n\nUse current web information. Cite claims with the web results. Never invent URLs or sources.`, max_output_tokens: 2048, tools: [{ type: "web_search_preview" }] } as any, { gateway: { id: "default" } }); const response = extractText(result); return json({ success: Boolean(response), response, sources: extractSources(result) }); }
async function handleVision(request: Request, env: Env) { const body = (await request.json()) as { prompt?: unknown; image?: unknown }, prompt = String(body.prompt || "Describe and analyze this image accurately.").trim().slice(0, 4000), image = String(body.image || "").trim(); if (!image) return json({ success: false, error: "An image is required." }, 400); if (image.length > 10_000_000) return json({ success: false, error: "Image is too large." }, 413); const rawImage = image.startsWith("data:") && image.includes(",") ? image.split(",", 2)[1] : image; const result = await env.AI.run(VISION_MODEL, { prompt, image: rawImage, max_tokens: MAX_TOKENS, temperature: 0.4 } as any); return json({ success: true, response: extractText(result) || String((result as any)?.response || "") }); }
async function handleTts(request: Request, env: Env) { const body = (await request.json()) as { text?: unknown; speaker?: unknown }, text = String(body.text || "").trim().slice(0, 5000); const allowed = new Set(["amalthea","andromeda","apollo","arcas","aries","asteria","athena","atlas","aurora","callista","cora","cordelia","delia","draco","electra","harmonia","helena","hera","hermes","hyperion","iris","janus","juno","jupiter","luna","mars","minerva","neptune","odysseus","ophelia","orion","orpheus","pandora","phoebe","pluto","saturn","thalia","theia","vesta","zeus"]); const speaker = allowed.has(String(body.speaker || "luna")) ? String(body.speaker || "luna") : "luna"; if (!text) return json({ success: false, error: "Text is required." }, 400); const audio = await env.AI.run(TTS_MODEL, { text, speaker, encoding: "mp3" } as any); return new Response(audio as ReadableStream, { status: 200, headers: { ...baseHeaders(), "content-type": "audio/mpeg", "content-disposition": "inline" } }); }

function msgpack(value: any): Uint8Array {
  const out: number[] = [];
  const put = (...bytes: number[]) => out.push(...bytes.map((b) => b & 255));
  const write = (v: any): void => {
    if (v === null || v === undefined) { put(0xc0); return; }
    if (v === false) { put(0xc2); return; }
    if (v === true) { put(0xc3); return; }
    if (v instanceof Uint8Array) {
      const n = v.length;
      if (n <= 0xff) put(0xc4, n); else if (n <= 0xffff) put(0xc5, n >> 8, n); else put(0xc6, n >>> 24, n >>> 16, n >>> 8, n);
      for (const b of v) put(b);
      return;
    }
    if (typeof v === "string") {
      const bytes = new TextEncoder().encode(v), n = bytes.length;
      if (n < 32) put(0xa0 | n); else if (n <= 0xff) put(0xd9, n); else if (n <= 0xffff) put(0xda, n >> 8, n); else put(0xdb, n >>> 24, n >>> 16, n >>> 8, n);
      for (const b of bytes) put(b);
      return;
    }
    if (typeof v === "number") {
      if (Number.isInteger(v) && v >= 0 && v <= 0x7f) { put(v); return; }
      if (Number.isInteger(v) && v >= -32 && v < 0) { put(v); return; }
      if (Number.isInteger(v) && v >= 0 && v <= 0xffffffff) { put(0xce, v >>> 24, v >>> 16, v >>> 8, v); return; }
      const b = new ArrayBuffer(8); new DataView(b).setFloat64(0, v); put(0xcb); for (const x of new Uint8Array(b)) put(x); return;
    }
    if (Array.isArray(v)) {
      const n = v.length;
      if (n < 16) put(0x90 | n); else if (n <= 0xffff) put(0xdc, n >> 8, n); else put(0xdd, n >>> 24, n >>> 16, n >>> 8, n);
      for (const item of v) write(item);
      return;
    }
    if (typeof v === "object") {
      const entries = Object.entries(v).filter(([, val]) => val !== undefined);
      const n = entries.length;
      if (n < 16) put(0x80 | n); else if (n <= 0xffff) put(0xde, n >> 8, n); else put(0xdf, n >>> 24, n >>> 16, n >>> 8, n);
      for (const [key, val] of entries) { write(key); write(val); }
      return;
    }
    put(0xc0);
  };
  write(value);
  return new Uint8Array(out);
}
async function handleDramaStudio(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ success: false, error: "The voice studio API only accepts same-origin browser requests." }, 403, {}, request);
  if (!env.DRAMA3_URL || !env.DRAMA3_API_KEY) return json({ success: false, error: "Drama 3 is not configured on this Worker yet. Set DRAMA3_URL and the DRAMA3_API_KEY secret." }, 503, {}, request);
  const body = await request.json() as { text?: unknown; format?: unknown; reference_audio?: unknown; reference_text?: unknown; reference_speaker?: unknown; director_note?: unknown };
  let text = String(body.text || "").trim().slice(0, 6000);
  const note = String(body.director_note || "").trim().slice(0, 500);
  if (!text) return json({ success: false, error: "A scene script is required." }, 400, {}, request);
  if (note) text = "Direction: " + note + "\nLine: " + text;
  const format = body.format === "mp3" || body.format === "opus" ? String(body.format) : "wav";
  const refs: any[] = [];
  if (body.reference_audio) {
    const encoded = String(body.reference_audio);
    if (encoded.length > 16_800_000) return json({ success: false, error: "Reference audio must be 12 MB or smaller." }, 413, {}, request);
    let audio: Uint8Array;
    try { const binary = atob(encoded); audio = Uint8Array.from(binary, (ch) => ch.charCodeAt(0)); } catch { return json({ success: false, error: "Reference audio must be valid base64." }, 400, {}, request); }
    const transcript = String(body.reference_text || "").trim().slice(0, 2000);
    if (!transcript) return json({ success: false, error: "The reference audio transcript is required." }, 400, {}, request);
    const speaker = Math.max(0, Math.min(15, Math.floor(Number(body.reference_speaker) || 0)));
    refs.push({ audio, text: transcript, speaker });
  }
  const payload: Record<string, unknown> = { text, references: refs, format, latency: "normal", single_chunk: false, streaming: false, use_memory_cache: "off" };
  const upstream = env.DRAMA3_URL.replace(/\/+$/, "") + "/v1/tts?format=msgpack";
  let response: Response;
  try {
    response = await fetch(upstream, { method: "POST", headers: { "authorization": "Bearer " + env.DRAMA3_API_KEY, "content-type": "application/msgpack", "accept": "audio/" + (format === "wav" ? "wav" : format) }, body: msgpack(payload) });
  } catch (error) {
    console.error("Drama 3 upstream connection failed", error);
    return json({ success: false, error: "Could not connect to the self-hosted Drama 3 server. Check its URL, TLS, and network access." }, 502, {}, request);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    console.error("Drama 3 upstream returned", response.status, detail);
    return json({ success: false, error: "Drama 3 server returned HTTP " + response.status + (detail ? ": " + detail : "") }, 502, {}, request);
  }
  return new Response(response.body, { status: 200, headers: { ...corsHeaders(request), "content-type": format === "wav" ? "audio/wav" : format === "mp3" ? "audio/mpeg" : "audio/ogg", "cache-control": "no-store", "content-disposition": "inline" } });
}

async function handleImage(request: Request, env: Env) { const body = (await request.json()) as { prompt?: unknown }, prompt = String(body.prompt || "").trim().slice(0, 2048); if (!prompt) return json({ success: false, error: "An image prompt is required." }, 400); const result: any = await env.AI.run(IMAGE_MODEL, { prompt }); const image = typeof result?.image === "string" ? result.image : typeof result?.result?.image === "string" ? result.result.image : ""; if (!image) return json({ success: false, error: "Image generation returned no image." }, 502); return json({ success: true, image, mimeType: "image/jpeg" }); }