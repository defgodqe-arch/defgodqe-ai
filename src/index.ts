import { Env, ChatMessage } from "./types";

const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const HF_CHAT_MODEL = "Qwen/Qwen3-4B";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const TTS_MODEL = "@cf/deepgram/aura-2-en";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_BODY_BYTES = 120_000;
const MAX_AUDIO_BYTES = 15_000_000;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_TOKENS = 640;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const usage = { requests: 0, chat: 0, web: 0, vision: 0, image: 0, tts: 0, errors: 0, started: Date.now() };
const SYSTEM_PROMPT = `You are defgodqe, an advanced AI assistant created by defgodqe.\nYour name is defgodqe.\nIf asked who created you, who made you, or who your creator is, clearly answer: "I was created by defgodqe." Do not claim another person or company created you.\nNever claim to be ChatGPT or another AI.\nYour tagline is "Your AI. Your Ideas. Your World.".\nSupport fluent English and Spanish. Reply in the same language as the user unless they request another language. For voice responses, use natural, concise spoken phrasing. Be helpful, accurate, creative, concise and honest.\nNever fabricate facts, sources, URLs, actions or files.\nWhen giving code, make it complete and runnable whenever practical.`
const rateBuckets = new Map<string, { count: number; reset: number }>();
function corsHeaders(request?: Request): HeadersInit {
  // This API is intentionally public and does not use cookie credentials.
  // Echo the browser origin when present (and use * for non-browser callers),
  // so Cloudflare/browser caches cannot reuse a mismatched CORS response.
  const origin = request?.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Defgodqe-Client, X-Turnstile-Token, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
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
export { DefGameRoomSqlite } from "./game-room";
export default { async fetch(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...corsHeaders(request), "content-length": "0", "cache-control": "no-store" } });
  const url = new URL(request.url);
  if (url.pathname === "/game") return handleGame(request, env);
  if (url.pathname === "/") return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  if (url.pathname === "/voice-studio.html" || url.pathname === "/voice-studio.js") return env.ASSETS.fetch(new Request(new URL(url.pathname, request.url), request));
  if (url.pathname === "/usage" && request.method === "GET") return json({ success: true, uptimeSeconds: Math.floor((Date.now() - usage.started) / 1000), ...usage, rateLimit: RATE_LIMIT });
  if (!["/chat", "/web-search", "/generate-image", "/vision", "/tts", "/studio/tts", "/transcribe"].includes(url.pathname)) return json({ success: false, error: "Not found" }, 404, {}, request);
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405, {}, request);
  const validationError = validateRequest(request, url.pathname === "/studio/tts" ? 18_000_000 : url.pathname === "/transcribe" ? MAX_AUDIO_BYTES + 100_000 : MAX_BODY_BYTES); if (validationError) return json({ success: false, error: validationError }, 413, {}, request);
  const rate = checkRateLimit(request); if (!rate.ok) return json({ success: false, error: "Too many requests. Please slow down.", retryAfter: rate.retryAfter }, 429, { "retry-after": String(rate.retryAfter) }, request);
  usage.requests++;
  try { if (url.pathname === "/chat") { usage.chat++; return await handleChat(request, env, url.searchParams.get("stream") === "1"); } if (url.pathname === "/web-search") { usage.web++; return await handleWebSearch(request, env); } if (url.pathname === "/vision") { usage.vision++; return await handleVision(request, env); } if (url.pathname === "/tts") { usage.tts++; return await handleTts(request, env); } if (url.pathname === "/transcribe") return await handleTranscribe(request, env); if (url.pathname === "/studio/tts") { usage.tts++; return await handleDramaStudio(request, env); } usage.image++; return await handleImage(request, env); } catch (error) { usage.errors++; console.error("defgodqe worker error", error); return json({ success: false, error: "The AI service encountered an internal error." }, 500, {}, request); }
} } satisfies ExportedHandler<Env>;
function handleGame(request: Request, env: Env): Promise<Response> | Response { if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return env.ASSETS.fetch(new Request(new URL("/game.html", request.url), request)); const url = new URL(request.url); const supplied = (url.searchParams.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); const room = supplied || crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase(); url.searchParams.set("room", room); const id = env.GAME_ROOMS.idFromName(room); return env.GAME_ROOMS.get(id).fetch(new Request(url.toString(), request)); }
async function handleChat(request: Request, env: Env, stream: boolean) {
  const body = (await request.json()) as { messages?: unknown };
  const messages = normalizeMessages(body.messages);
  if (!messages.length) return json({ success: false, error: "At least one message is required." }, 400, {}, request);
  if (!messages.some((message) => message.role === "system")) messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  // Prefer Hugging Face's fast provider router when HF_TOKEN is configured.
  // The token stays in the Worker secret store; it is never sent to the browser.
  if (!stream && env.HF_TOKEN) {
    try {
      const hf = await fetch("https://router.huggingface.co/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.HF_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.HF_MODEL || HF_CHAT_MODEL + ":fastest",
          messages,
          max_tokens: MAX_TOKENS,
          temperature: 0.65,
          top_p: 0.9
        })
      });
      if (hf.ok) {
        const payload: any = await hf.json();
        const response = String(payload?.choices?.[0]?.message?.content || "").trim();
        if (response) return json({ success: true, response, model: env.HF_MODEL || HF_CHAT_MODEL + ":fastest", provider: "huggingface" }, 200, {}, request);
        console.error("Hugging Face returned an empty response");
      } else {
        console.error("Hugging Face inference failed", hf.status, (await hf.text()).slice(0, 240));
      }
    } catch (error) {
      console.error("Hugging Face inference request failed", error);
    }
  }
  // Fallback keeps chat available if HF is not configured or its provider is temporarily unavailable.
  const candidates = [...new Set([CHAT_MODEL, "@cf/meta/llama-3.1-8b-instruct-fp8"])];
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
  return json({ success: true, response, provider: "cloudflare" }, 200, {}, request);
}
async function handleWebSearch(request: Request, env: Env) { const body = (await request.json()) as { query?: unknown }, query = String(body.query || "").trim().slice(0, 4000); if (!query) return json({ success: false, error: "A search query is required." }, 400); const result = await env.AI.run("openai/gpt-4o-mini", { input: `Search the live web for this query and answer accurately: ${query}\n\nUse current web information. Cite claims with the web results. Never invent URLs or sources.`, max_output_tokens: 2048, tools: [{ type: "web_search_preview" }] } as any, { gateway: { id: "default" } }); const response = extractText(result); return json({ success: Boolean(response), response, sources: extractSources(result) }); }
async function handleVision(request: Request, env: Env) { const body = (await request.json()) as { prompt?: unknown; image?: unknown }, prompt = String(body.prompt || "Describe and analyze this image accurately.").trim().slice(0, 4000), image = String(body.image || "").trim(); if (!image) return json({ success: false, error: "An image is required." }, 400); if (image.length > 10_000_000) return json({ success: false, error: "Image is too large." }, 413); const rawImage = image.startsWith("data:") && image.includes(",") ? image.split(",", 2)[1] : image; const result = await env.AI.run(VISION_MODEL, { prompt, image: rawImage, max_tokens: MAX_TOKENS, temperature: 0.4 } as any); return json({ success: true, response: extractText(result) || String((result as any)?.response || "") }); }
async function handleTranscribe(request: Request, env: Env) {
  if (!env.HF_TOKEN) return json({ success: false, error: "Whisper transcription is not configured. Add the HF_TOKEN Worker secret." }, 503, {}, request);
  const form = await request.formData();
  const file = form.get("audio");
  const language = String(form.get("language") || "auto");
  if (!(file instanceof File)) return json({ success: false, error: "An audio recording is required." }, 400, {}, request);
  if (file.size <= 0) return json({ success: false, error: "The audio recording is empty." }, 400, {}, request);
  if (file.size > MAX_AUDIO_BYTES) return json({ success: false, error: "Audio must be 15 MB or smaller." }, 413, {}, request);
  try {
    const upstream = await fetch("https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.HF_TOKEN, "Content-Type": file.type || "audio/webm", "Accept": "application/json" },
      body: await file.arrayBuffer()
    });
    const payload: any = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("Whisper inference failed", upstream.status, JSON.stringify(payload).slice(0, 300));
      return json({ success: false, error: upstream.status === 503 ? "Whisper is loading. Please try again in a moment." : "Whisper transcription failed. Check the Hugging Face token and model access." }, 502, {}, request);
    }
    const transcript = String(payload?.text || payload?.[0]?.text || "").trim();
    if (!transcript) return json({ success: false, error: "Whisper did not detect any speech." }, 422, {}, request);
    return json({ success: true, text: transcript, model: "openai/whisper-large-v3", language }, 200, {}, request);
  } catch (error) {
    console.error("Whisper request failed", error);
    return json({ success: false, error: "Could not connect to Whisper transcription." }, 502, {}, request);
  }
}

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
  const apiKey = env.FISH_AUDIO_API_KEY || env.DRAMA3_API_KEY;
  if (!apiKey) return json({ success: false, error: "Fish Audio is not configured. Add the FISH_AUDIO_API_KEY secret to this Cloudflare Worker." }, 503, {}, request);
  const body = await request.json() as { text?: unknown; format?: unknown; reference_id?: unknown; director_note?: unknown };
  let text = String(body.text || "").trim().slice(0, 6000);
  const note = String(body.director_note || "").trim().slice(0, 500);
  if (!text) return json({ success: false, error: "A scene script is required." }, 400, {}, request);
  if (note) text = "Direction: " + note + "\n" + text;
  const format = body.format === "wav" || body.format === "opus" ? String(body.format) : "mp3";
  const referenceId = String(body.reference_id || "").trim().slice(0, 200);
  const payload: Record<string, unknown> = { text, format };
  if (referenceId) payload.reference_id = referenceId;
  let response: Response;
  try {
    response = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        "authorization": "Bearer " + apiKey,
        "content-type": "application/json",
        "model": "drama-3",
        "accept": format === "wav" ? "audio/wav" : format === "opus" ? "audio/ogg" : "audio/mpeg"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("Fish Audio Drama 3 request failed", error);
    return json({ success: false, error: "Could not connect to Fish Audio. Try again shortly." }, 502, {}, request);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 350);
    console.error("Fish Audio Drama 3 returned", response.status, detail);
    let message = response.status === 401 || response.status === 403
      ? "Fish Audio rejected the API key. Check the FISH_AUDIO_API_KEY Worker secret."
      : response.status === 402
        ? "Your Fish Audio API account has insufficient API credit. Add API credit at https://fish.audio/app/developers, then try again."
        : "Fish Audio Drama 3 returned HTTP " + response.status + (detail ? ": " + detail : "");
    // Keep upstream client errors visible instead of incorrectly reporting them as a gateway failure.
    const status = [400, 401, 402, 403, 404, 422, 429].includes(response.status) ? response.status : 502;
    return json({ success: false, error: message }, status, {}, request);
  }
  const contentType = format === "wav" ? "audio/wav" : format === "opus" ? "audio/ogg" : "audio/mpeg";
  return new Response(response.body, { status: 200, headers: { ...corsHeaders(request), "content-type": contentType, "cache-control": "no-store", "content-disposition": "inline" } });
}

async function handleImage(request: Request, env: Env) { const body = (await request.json()) as { prompt?: unknown }, prompt = String(body.prompt || "").trim().slice(0, 2048); if (!prompt) return json({ success: false, error: "An image prompt is required." }, 400); const result: any = await env.AI.run(IMAGE_MODEL, { prompt }); const image = typeof result?.image === "string" ? result.image : typeof result?.result?.image === "string" ? result.result.image : ""; if (!image) return json({ success: false, error: "Image generation returned no image." }, 502); return json({ success: true, image, mimeType: "image/jpeg" }); }