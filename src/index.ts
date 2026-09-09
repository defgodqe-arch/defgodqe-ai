import { Env, ChatMessage } from "./types";

const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_BODY_BYTES = 120_000;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_TOKENS = 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;

const SYSTEM_PROMPT = `You are defgodqe, an advanced AI assistant.
Your name is defgodqe.
Never claim to be ChatGPT or another AI.
Your tagline is "Your AI. Your Ideas. Your World.".
Be helpful, accurate, creative, concise and honest.
Never fabricate facts, sources, URLs, actions or files.
When giving code, make it complete and runnable whenever practical.`;

const rateBuckets = new Map<string, { count: number; reset: number }>();

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type, X-Defgodqe-Client",
    "access-control-max-age": "86400",
  };
}

function json(data: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extra,
    },
  });
}

function getClientKey(request: Request) {
  return request.headers.get("X-Defgodqe-Client") || "anonymous";
}

function checkRateLimit(request: Request) {
  const key = getClientKey(request);
  const now = Date.now();
  const existing = rateBuckets.get(key);

  if (!existing || existing.reset <= now) {
    rateBuckets.set(key, { count: 1, reset: now + RATE_WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > RATE_LIMIT) {
    return { ok: false, retryAfter: Math.ceil((existing.reset - now) / 1000) };
  }

  return { ok: true, retryAfter: 0 };
}

function validateRequest(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  return contentLength > MAX_BODY_BYTES ? "Request body is too large." : null;
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_MESSAGES)
    .map((message: any) => ({
      role: message?.role,
      content: String(message?.content || "").slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter(
      (message): message is ChatMessage =>
        (message.role === "system" || message.role === "user" || message.role === "assistant") &&
        Boolean(message.content),
    );
}

function baseHeaders() {
  return {
    ...corsHeaders(),
    "cache-control": "no-cache, no-store, must-revalidate",
  };
}

function extractText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.output_text === "string") return value.output_text;
  if (typeof value.response === "string") return value.response;
  if (typeof value.text === "string") return value.text;
  if (Array.isArray(value.output)) {
    for (const item of value.output) {
      const found = extractText(item);
      if (found) return found;
    }
  }
  if (Array.isArray(value.content)) {
    for (const item of value.content) {
      const found = extractText(item);
      if (found) return found;
    }
  }
  return "";
}

function extractSources(value: any) {
  const results: Array<{ title: string; url: string; domain: string }> = [];
  const seen = new Set<string>();

  function visit(node: any) {
    if (!node || results.length >= 8) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;

    for (const annotation of Array.isArray(node.annotations) ? node.annotations : []) {
      if (annotation?.type !== "url_citation") continue;
      const url = String(annotation?.url || annotation?.citation?.url || "").trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      let domain = "";
      try {
        domain = new URL(url).hostname.replace(/^www\./, "");
      } catch {}
      results.push({
        title: String(annotation?.title || annotation?.citation?.title || domain || url),
        url,
        domain,
      });
    }

    for (const [key, child] of Object.entries(node)) {
      if (key !== "annotations") visit(child);
    }
  }

  visit(value);
  return results;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({ success: true, service: "defgodqe-ai", routes: ["/chat", "/web-search", "/generate-image"] });
    }

    if (!["/chat", "/web-search", "/generate-image"].includes(url.pathname)) {
      return json({ success: false, error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return json({ success: false, error: "Method not allowed" }, 405);
    }

    const validationError = validateRequest(request);
    if (validationError) return json({ success: false, error: validationError }, 413);

    const rate = checkRateLimit(request);
    if (!rate.ok) {
      return json(
        { success: false, error: "Too many requests. Please slow down.", retryAfter: rate.retryAfter },
        429,
        { "retry-after": String(rate.retryAfter) },
      );
    }

    try {
      if (url.pathname === "/chat") return await handleChat(request, env, url.searchParams.get("stream") === "1");
      if (url.pathname === "/web-search") return await handleWebSearch(request, env);
      return await handleImage(request, env);
    } catch (error) {
      console.error("defgodqe worker error", error);
      return json({ success: false, error: "The AI service encountered an internal error." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleChat(request: Request, env: Env, stream: boolean) {
  const body = (await request.json()) as { messages?: unknown };
  const messages = normalizeMessages(body.messages);
  if (!messages.length) return json({ success: false, error: "At least one message is required." }, 400);

  if (!messages.some((message) => message.role === "system")) {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }

  const result = await env.AI.run(CHAT_MODEL, {
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0.65,
    top_p: 0.9,
    stream,
  } as any);

  if (stream) {
    return new Response(result as ReadableStream, {
      status: 200,
      headers: { ...baseHeaders(), "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive" },
    });
  }

  return json({ success: true, response: extractText(result) || String((result as any)?.response || "") });
}

async function handleWebSearch(request: Request, env: Env) {
  const body = (await request.json()) as { query?: unknown };
  const query = String(body.query || "").trim().slice(0, 4000);
  if (!query) return json({ success: false, error: "A search query is required." }, 400);

  const result = await env.AI.run(
    "openai/gpt-4o-mini",
    {
      input: `Search the live web for this query and answer accurately: ${query}\n\nUse current web information. Cite claims with the web results. Never invent URLs or sources.`,
      max_output_tokens: 2048,
      tools: [{ type: "web_search_preview" }],
    } as any,
    { gateway: { id: "default" } },
  );

  const response = extractText(result);
  return json({ success: Boolean(response), response, sources: extractSources(result) });
}

async function handleImage(request: Request, env: Env) {
  const body = (await request.json()) as { prompt?: unknown };
  const prompt = String(body.prompt || "").trim().slice(0, 2048);
  if (!prompt) return json({ success: false, error: "An image prompt is required." }, 400);

  const result: any = await env.AI.run(IMAGE_MODEL, { prompt, num_steps: 4 });
  const image = typeof result?.image === "string" ? result.image : "";
  if (!image) return json({ success: false, error: "Image generation returned no image." }, 502);

  return json({ success: true, image, mimeType: "image/jpeg" });
}
