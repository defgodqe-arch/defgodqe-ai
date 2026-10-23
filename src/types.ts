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
  /** Fish Audio hosted API key for Drama 3. Server-side secret only; never expose to browsers. */
  FISH_AUDIO_API_KEY?: string;
  /** Legacy server-side secret name accepted as a fallback for Drama 3. */
  DRAMA3_API_KEY?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
