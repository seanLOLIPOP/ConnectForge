import manifestTools from '../app/update-manifest.cjs';
import {randomUUID} from 'node:crypto';
const {verify,newer}=manifestTools;
const fail=(s,n=400)=>{throw Object.assign(Error(s),{status:n});};
export function updateService({db,peers,send,audit,clock,publicKey,adminEmails=[]}){
 db.exec(`CREATE TABLE IF NOT EXISTS update_releases(version TEXT PRIMARY KEY,envelope TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS update_jobs(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,version TEXT NOT NULL,state TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,updated INTEGER NOT NULL);`);
 const cols=db.prepare('PRAGMA table_info(devices)').all().map(c=>c.name);
 if(!cols.includes('app_version'))db.exec("ALTER TABLE devices ADD COLUMN app_version TEXT NOT NULL DEFAULT '0.0.0'");
 if(!cols.includes('arch'))db.exec("ALTER TABLE devices ADD COLUMN arch TEXT NOT NULL DEFAULT 'unknown'");
 const admins=new Set(adminEmails.map(v=>v.trim().toLowerCase()));
 const isAdmin=u=>!!u.email&&admins.has(u.email.trim().toLowerCase());
 const envelope=v=>JSON.parse(db.prepare('SELECT envelope FROM update_releases WHERE version=?').get(v).envelope);
 function notify(id){send(peers.get(id)?.ws,{type:'update-available'});}
 function register(id,b){const ver=typeof b.appVersion==='string'&&/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(b.appVersion)?b.appVersion:'0.0.0',arch=['x64','arm64'].includes(b.arch)?b.arch:'unknown';db.prepare('UPDATE devices SET app_version=?,arch=? WHERE id=?').run(ver,arch,id);db.prepare("UPDATE update_jobs SET state='installed',updated=? WHERE device_id=? AND version=? AND state NOT IN ('cancelled','declined')").run(clock(),id,ver);}
 async function route({p,req,a,read,reply}){
  if(p==='/api/admin/updates/role'&&req.method==='GET'){reply({allowed:isAdmin(a.u)});return true;}
  if(p.startsWith('/api/admin/updates/')){
   if(!isAdmin(a.u))fail('This SI account cannot administer updates',403);
   if(!publicKey)fail('Update signing key is not configured',503);
   if(p==='/api/admin/updates/devices'&&req.method==='GET'){reply({devices:db.prepare('SELECT id,user_id,name,platform,arch,app_version,last_seen FROM devices ORDER BY name').all().map(d=>({...d,online:peers.has(d.id),update:db.prepare('SELECT id,version,state,detail,updated FROM update_jobs WHERE device_id=? ORDER BY created DESC LIMIT 1').get(d.id)||null}))});return true;}
   if(p==='/api/admin/updates/releases'&&req.method==='GET'){reply({releases:db.prepare('SELECT version,envelope FROM update_releases ORDER BY created DESC').all().map(r=>({version:r.version,...JSON.parse(r.envelope)}))});return true;}
   if(p==='/api/admin/updates/releases'&&req.method==='POST'){
    const b=await read(req);let m;try{m=verify(b,publicKey);}catch(e){fail(e.message);}
    const old=db.prepare('SELECT envelope FROM update_releases WHERE version=?').get(m.version);if(old&&old.envelope!==JSON.stringify(b))fail('This version is already published with another manifest',409);
    db.prepare('INSERT OR IGNORE INTO update_releases VALUES(?,?,?)').run(m.version,JSON.stringify(b),clock());audit(a.u.id,'update-release:'+m.version);reply({ok:true});return true;
   }
   if(p==='/api/admin/updates/push'&&req.method==='POST'){
    const b=await read(req);if(!Array.isArray(b.deviceIds)||!b.deviceIds.length||b.deviceIds.length>100||new Set(b.deviceIds).size!==b.deviceIds.length)fail('Select 1–100 computers');
    const release=db.prepare('SELECT envelope FROM update_releases WHERE version=?').get(b.version);if(!release)fail('Import a signed release first');const m=verify(JSON.parse(release.envelope),publicKey);
    const targets=b.deviceIds.map(id=>{if(typeof id!=='string')fail('Invalid computer');const d=db.prepare('SELECT * FROM devices WHERE id=?').get(id);if(!d)fail('Computer not found');if(!newer(d.app_version,'0.3.99'))fail(d.name+': install version 0.4.0 or later manually first');if(!newer(m.version,d.app_version))fail(d.name+': release must be newer than the installed version');if(!m.assets.some(x=>x.platform===d.platform&&x.arch===d.arch))fail(d.name+': release has no compatible download');return d;});
    const ids=[];db.exec('BEGIN IMMEDIATE');try{for(const d of targets){db.prepare("UPDATE update_jobs SET state='cancelled',updated=? WHERE device_id=? AND state IN ('offered','deferred','downloading','ready','failed')").run(clock(),d.id);const id=randomUUID();db.prepare("INSERT INTO update_jobs VALUES(?,?,?,'offered','',?,?)").run(id,d.id,m.version,clock(),clock());ids.push(id);audit(a.u.id,'update-pushed:'+m.version,d.id);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}for(const d of targets)notify(d.id);reply({ok:true,jobs:ids});return true;
   }
   if(p==='/api/admin/updates/cancel'&&req.method==='POST'){const b=await read(req);const j=db.prepare('SELECT * FROM update_jobs WHERE id=?').get(b.id);if(!j)fail('Update not found',404);if(['installing','installed'].includes(j.state))fail('Update has already been approved for restart',409);db.prepare("UPDATE update_jobs SET state='cancelled',updated=? WHERE id=?").run(clock(),j.id);audit(a.u.id,'update-cancelled',j.device_id);notify(j.device_id);reply({ok:true});return true;}
   fail('Not found',404);
  }
  if(p.startsWith('/api/updates/')){
   const device=req.headers['x-si-device'],key=req.headers['x-si-device-key'];const d=db.prepare('SELECT * FROM devices WHERE id=? AND user_id=?').get(typeof device==='string'?device:'',a.u.id);if(!d||d.identity_key!==key)fail('Device registration required',403);
   if(p==='/api/updates/current'&&req.method==='GET'){const j=db.prepare("SELECT * FROM update_jobs WHERE device_id=? AND state NOT IN ('installed','declined','cancelled') ORDER BY created DESC LIMIT 1").get(d.id);reply({job:j?{...j,envelope:envelope(j.version)}:null});return true;}
   if(p==='/api/updates/status'&&req.method==='POST'){const b=await read(req),j=db.prepare('SELECT * FROM update_jobs WHERE id=? AND device_id=?').get(b.id,d.id);if(!j)fail('Update not found',404);if(['cancelled','declined','installed'].includes(j.state))fail('Update is no longer available',409);const transitions={offered:['downloading','deferred','declined','failed'],deferred:['downloading','declined','failed'],downloading:['ready','failed','deferred'],ready:['installing','deferred','declined','failed'],failed:['downloading','deferred','declined'],installing:['failed']};if(!transitions[j.state]?.includes(b.state))fail('Invalid update status',409);if(b.state==='installing'&&req.headers['x-si-restart-approved']!=='yes')fail('User restart approval required',403);db.prepare('UPDATE update_jobs SET state=?,detail=?,updated=? WHERE id=?').run(b.state,typeof b.detail==='string'?b.detail.slice(0,300):'',clock(),j.id);audit(a.u.id,'update-'+b.state,d.id);reply({ok:true});return true;}
   fail('Not found',404);
  }
  return false;
 }
 return {route,register};
}
