/**
 * Type definitions for the defgodqe AI Worker.
 */
export interface Env {
  AI: Ai;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  RATE_LIMITER: RateLimit;
  GAME_ROOMS: DurableObjectNamespace;
  /** Private base URL for the self-hosted Fish Speech API server, without a trailing slash. */
  DRAMA3_URL?: string;
  /** Server-side secret matching the Fish Speech API server --api-key option. Never expose to browsers. */
  DRAMA3_API_KEY?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
