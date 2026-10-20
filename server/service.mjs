import http from 'node:http';
import https from 'node:https';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {verifyLogin} from './identity.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const uid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const cleanUser=u=>({id:u.id,username:u.username});
export function createService({identity,database=':memory:',tls,turnSecret='',turnHost='',turnPort=3478,cloudflareRelayHost='',clock=()=>Date.now()}){
  const db=new DatabaseSync(database);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,version TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,platform TEXT NOT NULL,identity_key TEXT NOT NULL,last_seen INTEGER NOT NULL,unattended INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,user_id TEXT,action TEXT NOT NULL,device_id TEXT);
  `);
  const peers=new Map(),calls=new Map(),limits=new Map();
  function audit(user,action,device){db.prepare('INSERT INTO audit(at,user_id,action,device_id) VALUES(?,?,?,?)').run(clock(),user,action,device||null);}
  function rate(key,max=30){let v=limits.get(key);if(!v||clock()-v.at>900000){v={at:clock(),n:0};limits.set(key,v);}if(++v.n>max)fail('Too many requests. Try again later.',429);}
  async function account(token){
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('Please sign in',401);
    const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(hash(token),clock());if(!s)fail('Please sign in',401);
    const u=await identity.user(s.user_id);
    if(!u||hash(u.salt+u.hash)!==s.version){db.prepare('DELETE FROM sessions WHERE user_id=?').run(s.user_id);fail('Your SI account changed. Sign in again.',401);}
    return {u,tokenHash:hash(token),expires:s.expires};
  }
  function ice(user){const iceServers=[];if(turnHost){iceServers.push({urls:cloudflareRelayHost?'stun:stun.cloudflare.com:3478':`stun:${turnHost}:${turnPort}`});if(turnSecret){const username=Math.floor(clock()/1000+3600)+':'+user;iceServers.push({urls:[`turn:${turnHost}:${turnPort}?transport=udp`,`turn:${turnHost}:${turnPort}?transport=tcp`],username,credential:createHmac('sha1',turnSecret).update(username).digest('base64')});}}return {iceServers,relayAvailable:!!(turnHost&&turnSecret),...(cloudflareRelayHost?{cloudflareRelayHost}:{})};}
  function send(ws,v){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(v));}
  function devices(user){return db.prepare('SELECT id,name,platform,last_seen,unattended FROM devices WHERE user_id=? ORDER BY name').all(user).map(d=>({...d,unattended:!!d.unattended,online:peers.has(d.id)}));}
  function broadcast(user){for(const p of peers.values())if(p.user===user)send(p.ws,{type:'devices',devices:devices(user)});}
  function endCall(id,reason='Session ended'){const c=calls.get(id);if(!c)return;for(const d of [c.host,c.viewer])send(peers.get(d)?.ws,{type:'ended',session:id,reason});calls.delete(id);audit(c.user,'session-ended',c.host);}
  async function read(req){let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>16384)fail('Request too large',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail('Invalid JSON');}}
  const handler=async(req,res)=>{
    const reply=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(v));};
    try{
      const p=new URL(req.url,'http://localhost').pathname;
      if(req.headers.origin)fail('Use the SI Remote desktop app',403);
      if(p==='/health'&&req.method==='GET')return reply({ok:true,name:'SI Remote',version:'0.1.0',relayAvailable:!!(turnHost&&turnSecret)});
      if(p==='/api/login'&&req.method==='POST'){
        rate('login:'+req.socket.remoteAddress);const b=await read(req);rate('email:'+String(b.email).trim().toLowerCase(),15);
        const u=await verifyLogin(identity,b.email,b.password),token=randomBytes(32).toString('hex'),expires=clock()+30*86400000;
        db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),u.id,hash(u.salt+u.hash),expires);audit(u.id,'login');return reply({token,expires,user:cleanUser(u)});
      }
      const a=await account(req.headers.authorization?.replace(/^Bearer /,''));
      if(p==='/api/me'&&req.method==='GET')return reply({user:cleanUser(a.u)});
      if(p==='/api/logout'&&req.method==='POST'){
        db.prepare('DELETE FROM sessions WHERE token=?').run(a.tokenHash);
        for(const peer of peers.values())if(peer.tokenHash===a.tokenHash)peer.ws.close(1000,'Signed out');return reply({ok:true});
      }
      if(p==='/api/devices'&&req.method==='GET')return reply({devices:devices(a.u.id)});
      if(p==='/api/devices'&&req.method==='POST'){
        const b=await read(req);if(!uid(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||!['win32','darwin','linux'].includes(b.platform)||typeof b.identityKey!=='string'||!/^[a-f0-9]{64}$/.test(b.identityKey))fail('Invalid device');
        const old=db.prepare('SELECT * FROM devices WHERE id=?').get(b.id);
        if(old&&(old.user_id!==a.u.id||old.identity_key!==b.identityKey))fail('This device belongs to another registration',403);
        if(!old&&devices(a.u.id).length>=50)fail('Device limit reached');
        db.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,last_seen=excluded.last_seen,unattended=excluded.unattended').run(b.id,a.u.id,b.name.trim(),b.platform,b.identityKey,clock(),b.unattended===true?1:0);
        audit(a.u.id,'device-registered',b.id);broadcast(a.u.id);return reply({ok:true});
      }
      const m=p.match(/^\/api\/devices\/([a-f0-9-]{36})$/);
      if(m&&req.method==='DELETE'){
        const d=db.prepare('SELECT * FROM devices WHERE id=? AND user_id=?').get(m[1],a.u.id);if(!d)fail('Device not found',404);
        for(const [id,c] of calls)if(c.host===d.id||c.viewer===d.id)endCall(id,'Device removed');peers.get(d.id)?.ws.close(1000,'Device removed');
        db.prepare('DELETE FROM devices WHERE id=? AND user_id=?').run(d.id,a.u.id);audit(a.u.id,'device-removed',d.id);broadcast(a.u.id);return reply({ok:true});
      }
      if(p==='/api/ice'&&req.method==='GET')return reply(ice(a.u.id));
      fail('Not found',404);
    }catch(e){reply({error:e.status?e.message:'Service unavailable'},e.status||503);}
  };
  const server=tls?https.createServer(tls,handler):http.createServer(handler);
  const wss=new WebSocketServer({noServer:true,maxPayload:128*1024});
  server.on('upgrade',(req,socket,head)=>{if(req.url!=='/signal'||req.headers.origin){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
  wss.on('connection',(ws,req)=>{
    let peer,alive=true,processing=false;const deadline=setTimeout(()=>{if(!peer)ws.close(1008,'Authentication required');},5000);
    ws.on('pong',()=>{alive=true;});const ping=setInterval(()=>{if(!alive)return ws.terminate();alive=false;ws.ping();},25000);
    ws.on('message',async raw=>{
      try{
        const b=JSON.parse(raw.toString());if(!b||typeof b!=='object')fail('Invalid message');
        if(!peer){
          if(processing)fail('Authentication pending');processing=true;
          if(b.type!=='auth')fail('Authentication required',401);rate('ws:'+req.socket.remoteAddress,100);
          const a=await account(b.token),d=db.prepare('SELECT * FROM devices WHERE id=? AND user_id=?').get(b.device,a.u.id);
          if(ws.readyState!==WebSocket.OPEN)return;
          if(!d||d.identity_key!==b.identityKey)fail('Register this device first',403);
          const previous=peers.get(d.id);if(previous)previous.ws.close(1000,'Device reconnected');
          peer={id:d.id,user:a.u.id,ws,tokenHash:a.tokenHash,expires:a.expires};peers.set(d.id,peer);clearTimeout(deadline);
          send(ws,{type:'ready',device:d.id,...ice(a.u.id)});broadcast(peer.user);return;
        }
        rate('signal:'+peer.id,5000);
        if(peer.expires<=clock())fail('Sign in again',401);
        if(b.type==='heartbeat'){db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(clock(),peer.id);return;}
        if(b.type==='connect'){
          const host=peers.get(b.device),d=db.prepare('SELECT * FROM devices WHERE id=? AND user_id=?').get(b.device,peer.user);
          if(!host||!d)fail('That computer is offline',404);if(host.id===peer.id)fail('Choose a different computer');
          if([...calls.values()].some(c=>[c.host,c.viewer].includes(host.id)||[c.host,c.viewer].includes(peer.id)))fail('A computer is already in a session',409);
          const id=randomUUID();calls.set(id,{host:host.id,viewer:peer.id,user:peer.user,at:clock(),accepted:false});
          send(host.ws,{type:'incoming',session:id,viewer:peer.id,viewerName:db.prepare('SELECT name FROM devices WHERE id=?').get(peer.id).name});send(ws,{type:'connecting',session:id,device:host.id});audit(peer.user,'session-requested',host.id);return;
        }
        const c=calls.get(b.session);if(!c||c.user!==peer.user||![c.host,c.viewer].includes(peer.id))fail('Session not authorized',403);
        const other=peers.get(c.host===peer.id?c.viewer:c.host);
        if(b.type==='end'){endCall(b.session);return;}
        if(b.type==='accept'){
          if(peer.id!==c.host||c.accepted)fail('Invalid approval',403);c.accepted=true;c.at=clock();
          send(other?.ws,{type:'accepted',session:b.session,...ice(peer.user)});return;
        }
        if(b.type==='signal'){
          if(!c.accepted)fail('Session not approved',403);
          const payload=b.payload;if(!payload||typeof payload!=='object'||!['offer','answer','candidate','restart'].includes(payload.kind))fail('Invalid signal');
          send(other?.ws,{type:'signal',session:b.session,payload});return;
        }
        fail('Unknown message');
      }catch(e){send(ws,{type:'error',message:e.status?e.message:'Connection service unavailable'});if(e.status===401)ws.close(1008,'Sign in again');}
    });
    ws.on('error',()=>{});ws.on('close',()=>{clearTimeout(deadline);clearInterval(ping);if(peer&&peers.get(peer.id)===peer){peers.delete(peer.id);for(const [id,c]of calls)if([c.host,c.viewer].includes(peer.id))endCall(id,'Computer disconnected');broadcast(peer.user);}});
  });
  const cleanup=setInterval(async()=>{
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(clock());db.prepare('DELETE FROM audit WHERE at<?').run(clock()-90*86400000);
    for(const [key,v]of limits)if(clock()-v.at>900000)limits.delete(key);
    for(const [id,c]of calls)if(!c.accepted&&clock()-c.at>60000)endCall(id,'Connection timed out');
    for(const p of peers.values()){
      try{const s=db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(p.tokenHash,clock()),u=s&&await identity.user(p.user);if(!u||hash(u.salt+u.hash)!==s.version)p.ws.close(1008,'Sign in again');}catch{p.ws.close(1011,'Account service unavailable');}
    }
  },60000);cleanup.unref();
  return {server,db,async close(){clearInterval(cleanup);for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));db.close();}};
}
