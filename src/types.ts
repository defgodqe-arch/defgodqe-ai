/**
 * Type definitions for the defgodqe AI Worker.
 */
export interface Env {
  AI: Ai;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  RATE_LIMITER: RateLimit;
  GAME_ROOMS: DurableObjectNamespace;
  /** Optional Hugging Face Inference Providers token; configure as a Worker secret. */
  HF_TOKEN?: string;
  /** Optional Hugging Face model override, e.g. Qwen/Qwen3-4B:fastest. */
  HF_MODEL?: string;
  /** Private base URL for the self-hosted Fish Speech API server, without a trailing slash. */
  DRAMA3_URL?: string;
  /** Server-side secret matching the Fish Speech API server --api-key option. Never expose to browsers. */
  DRAMA3_API_KEY?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
