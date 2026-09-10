const MAX_PLAYERS = 8;
const MOVE_SPEED = 0.32;
const TAG_DISTANCE = 0.055;

type Player = {
  id: string;
  name: string;
  x: number;
  y: number;
  it: boolean;
};

function roomState(players: Map<string, Player>) {
  return { players: [...players.values()].map(({ id, name, x, y, it }) => ({ id, name, x, y, it })) };
}

function randomId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export class DefGameRoom implements DurableObject {
  private sockets = new Map<WebSocket, Player>();
  private players = new Map<string, Player>();

  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return new Response("NEON TAG room is ready. Connect with WebSocket.", { status: 426 });
    }

    if (this.sockets.size >= MAX_PLAYERS) {
      return new Response(JSON.stringify({ success: false, error: "Room is full (8 players maximum)." }), {
        status: 429,
        headers: { "content-type": "application/json" }
      });
    }

    const url = new URL(request.url);
    const room = (url.searchParams.get("room") || "------").toUpperCase().slice(0, 6);
    const name = (url.searchParams.get("name") || "Player").trim().slice(0, 18) || "Player";
    const [client, server] = Object.values(new WebSocketPair());
    const player: Player = {
      id: randomId(),
      name,
      x: 0.15 + Math.random() * 0.7,
      y: 0.2 + Math.random() * 0.6,
      it: this.players.size === 0
    };

    this.players.set(player.id, player);
    this.sockets.set(server, player);
    server.accept();

    server.addEventListener("message", (event) => this.onMessage(server, event.data));
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));

    server.send(JSON.stringify({ type: "welcome", id: player.id, room, players: roomState(this.players).players }));
    this.broadcast({ type: "state", players: roomState(this.players).players });

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const player = this.sockets.get(socket);
    if (!player) return;
    let message: any;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    if (message?.type !== "move") return;
    const x = Number(message.x);
    const y = Number(message.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const length = Math.hypot(x, y) || 1;
    const nx = clamp(x / length, -1, 1);
    const ny = clamp(y / length, -1, 1);
    player.x = clamp(player.x + nx * MOVE_SPEED * 0.05, 0.025, 0.975);
    player.y = clamp(player.y + ny * MOVE_SPEED * 0.05, 0.06, 0.94);

    if (player.it) {
      for (const target of this.players.values()) {
        if (target.id === player.id) continue;
        if (Math.hypot(player.x - target.x, player.y - target.y) <= TAG_DISTANCE) {
          player.it = false;
          target.it = true;
          break;
        }
      }
    }

    this.broadcast({ type: "state", players: roomState(this.players).players });
  }

  private onClose(socket: WebSocket) {
    const player = this.sockets.get(socket);
    if (!player) return;
    this.sockets.delete(socket);
    this.players.delete(player.id);
    if (player.it && this.players.size) {
      const next = [...this.players.values()][Math.floor(Math.random() * this.players.size)];
      next.it = true;
    }
    this.broadcast({ type: "state", players: roomState(this.players).players });
  }

  private broadcast(payload: unknown) {
    const data = JSON.stringify(payload);
    for (const socket of this.sockets.keys()) {
      try { socket.send(data); } catch { this.onClose(socket); }
    }
  }
}
