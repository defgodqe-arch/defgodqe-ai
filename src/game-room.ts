const MAX_PLAYERS = 8;
const MOVE_SPEED = 0.32;
const TAG_DISTANCE = 0.055;
const FREEZE_MS = 5000;
const SHOT_COOLDOWN_MS = 350;
const LASER_RANGE = 0.72;
const HIT_RADIUS = 0.045;
const ROUND_MS = 180000;

type Player = { id: string; name: string; x: number; y: number; it: boolean; frozenUntil: number; score: number };

function roomState(players: Map<string, Player>) {
  const now = Date.now();
  return { players: [...players.values()].map(p => ({ id:p.id,name:p.name,x:p.x,y:p.y,it:p.it,frozen:p.frozenUntil>now,frozenUntil:p.frozenUntil,score:p.score })) };
}
function randomId(){ return crypto.randomUUID().replace(/-/g,"").slice(0,10); }
function clamp(v:number,min:number,max:number){ return Math.max(min,Math.min(max,v)); }
function pointToSegmentDistance(px:number,py:number,ax:number,ay:number,bx:number,by:number){ const abx=bx-ax,aby=by-ay,ab2=abx*abx+aby*aby; if(!ab2)return Math.hypot(px-ax,py-ay); const t=clamp(((px-ax)*abx+(py-ay)*aby)/ab2,0,1); return Math.hypot(px-(ax+abx*t),py-(ay+aby*t)); }
function makeRoomCode(){ return Math.random().toString(36).slice(2,8).toUpperCase().padEnd(6,"X").slice(0,6); }

export class DefGameRoom implements DurableObject {
  private sockets=new Map<WebSocket,Player>();
  private players=new Map<string,Player>();
  private lastShot=new Map<string,number>();
  private roundStarted=Date.now();
  private roundOver=false;
  constructor(private state:DurableObjectState,private env:unknown){}

  async fetch(request:Request):Promise<Response>{
    if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket") return new Response("NEON TAG room is ready. Connect with WebSocket.",{status:426});
    if(this.sockets.size>=MAX_PLAYERS) return new Response(JSON.stringify({success:false,error:"Room is full (8 players maximum)."}),{status:429,headers:{"content-type":"application/json"}});
    const url=new URL(request.url);
    const room=(url.searchParams.get("room")||makeRoomCode()).toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6).padEnd(6,"X");
    const name=(url.searchParams.get("name")||"Player").trim().slice(0,18)||"Player";
    if(this.players.size===0){this.roundStarted=Date.now();this.roundOver=false;}
    const [client,server]=Object.values(new WebSocketPair());
    const player:Player={id:randomId(),name,x:.15+Math.random()*.7,y:.2+Math.random()*.6,it:this.players.size===0,frozenUntil:0,score:0};
    this.players.set(player.id,player);this.sockets.set(server,player);server.accept();
    server.addEventListener("message",e=>this.onMessage(server,e.data));server.addEventListener("close",()=>this.onClose(server));server.addEventListener("error",()=>this.onClose(server));
    server.send(JSON.stringify({type:"welcome",id:player.id,room,players:roomState(this.players).players,roundStarted:this.roundStarted,roundEnds:this.roundStarted+ROUND_MS}));
    this.broadcastState();
    return new Response(null,{status:101,webSocket:client});
  }

  private onMessage(socket:WebSocket,raw:string|ArrayBuffer){
    const player=this.sockets.get(socket);if(!player)return;let m:any;try{m=JSON.parse(typeof raw==="string"?raw:new TextDecoder().decode(raw));}catch{return;}
    if(m?.type==="move")this.onMove(player,m); else if(m?.type==="shoot")this.onShoot(player,m); else if(m?.type==="thaw")this.onThaw(player,m);
  }
  private checkRound(){ if(!this.roundOver&&Date.now()-this.roundStarted>=ROUND_MS){this.roundOver=true;const winner=[...this.players.values()].sort((a,b)=>b.score-a.score)[0];this.broadcast({type:"round_end",winner:winner?{id:winner.id,name:winner.name,score:winner.score}:null});} return !this.roundOver; }
  private onMove(player:Player,m:any){
    if(!this.checkRound())return;const x=Number(m.x),y=Number(m.y),now=Date.now();if(!Number.isFinite(x)||!Number.isFinite(y)||player.frozenUntil>now)return;
    const len=Math.hypot(x,y)||1;player.x=clamp(player.x+clamp(x/len,-1,1)*MOVE_SPEED*.05,.025,.975);player.y=clamp(player.y+clamp(y/len,-1,1)*MOVE_SPEED*.05,.06,.94);
    if(player.it){for(const target of this.players.values()){if(target.id===player.id||target.frozenUntil>now)continue;if(Math.hypot(player.x-target.x,player.y-target.y)<=TAG_DISTANCE){player.it=false;target.it=true;this.broadcast({type:"tag",from:player.id,to:target.id});break;}}}
    this.broadcastState();
  }
  private onShoot(player:Player,m:any){
    if(!this.checkRound())return;const now=Date.now();if(player.frozenUntil>now)return;const previous=this.lastShot.get(player.id)||0;if(now-previous<SHOT_COOLDOWN_MS)return;const angle=Number(m.angle);if(!Number.isFinite(angle))return;this.lastShot.set(player.id,now);
    const endX=clamp(player.x+Math.cos(angle)*LASER_RANGE,.025,.975),endY=clamp(player.y+Math.sin(angle)*LASER_RANGE,.06,.94);let hit:Player|null=null,best=Infinity;
    for(const target of this.players.values()){if(target.id===player.id||target.frozenUntil>now)continue;const d=pointToSegmentDistance(target.x,target.y,player.x,player.y,endX,endY);if(d<=HIT_RADIUS){const along=Math.hypot(target.x-player.x,target.y-player.y);if(along<best){best=along;hit=target;}}}
    this.broadcast({type:"beam",from:player.id,x:player.x,y:player.y,angle,range:LASER_RANGE,hit:hit?.id||null});
    if(!hit)return;hit.frozenUntil=now+FREEZE_MS;player.score++;this.broadcast({type:"freeze",shooter:player.id,target:hit.id,duration:FREEZE_MS,score:player.score});this.broadcastState();
  }
  private onThaw(player:Player,m:any){const target=this.players.get(String(m.targetId||"")),now=Date.now();if(!target||target.id===player.id||target.frozenUntil<=now||player.frozenUntil>now)return;if(Math.hypot(player.x-target.x,player.y-target.y)>TAG_DISTANCE*1.8)return;target.frozenUntil=0;this.broadcast({type:"thaw",by:player.id,target:target.id});this.broadcastState();}
  private broadcastState(){this.broadcast({type:"state",players:roomState(this.players).players,roundEnds:this.roundStarted+ROUND_MS,roundOver:this.roundOver});}
  private onClose(socket:WebSocket){const p=this.sockets.get(socket);if(!p)return;this.sockets.delete(socket);this.players.delete(p.id);this.lastShot.delete(p.id);if(p.it&&this.players.size)[...this.players.values()][Math.floor(Math.random()*this.players.size)].it=true;this.broadcastState();}
  private broadcast(payload:unknown){const data=JSON.stringify(payload);for(const socket of [...this.sockets.keys()]){try{socket.send(data);}catch{this.onClose(socket);}}}
}
