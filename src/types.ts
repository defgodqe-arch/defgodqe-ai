/**
 * Type definitions for the defgodqe AI Worker.
 */
export interface Env {
  AI: Ai;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  RATE_LIMITER: RateLimit;
  GAME_ROOMS: DurableObjectNamespace;\n  /** Private base URL for the self-hosted Fish Speech API server, without a trailing slash. */\n  DRAMA3_URL?: string;\n  /** Server-side secret matching the Fish Speech API server --api-key option. Never expose to browsers. */\n  DRAMA3_API_KEY?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
