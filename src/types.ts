/**
 * Type definitions for the defgodqe AI Worker.
 */
export interface Env {
  AI: Ai;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  RATE_LIMITER: RateLimit;
  GAME_ROOMS: DurableObjectNamespace;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
