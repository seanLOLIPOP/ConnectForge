import {test} from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,sign,createHash,randomBytes,randomUUID,scryptSync} from 'node:crypto';import {once} from 'node:events';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import tools from '../app/update-manifest.cjs';import updater from '../app/updater.cjs';import {createService} from '../server/service.mjs';
const keys=generateKeyPairSync('ed25519'),bytes=Buffer.from('a signed test artifact, never executed'),sha=createHash('sha256').update(bytes).digest('hex');
function release(version='0.4.1'){const manifest={schema:1,appId:'com.si.remote',version,publishedAt:new Date().toISOString(),assets:[{platform:process.platform,arch:process.arch,url:'https://github.com/seanLOLIPOP/ConnectForge/releases/download/v'+version+'/'+tools.filename(version,process.platform,process.arch),sha256:sha,bytes:bytes.length}]};return {manifest,signature:sign(null,Buffer.from(tools.canonical(manifest)),keys.privateKey).toString('base64')};}
function signed(manifest){return {manifest,signature:sign(null,Buffer.from(tools.canonical(manifest)),keys.privateKey).toString('base64')};}
test('release verification rejects tampering, another key, downgrades and foreign artifact URLs',()=>{
 const r=release();assert.equal(tools.verify(r,keys.publicKey).version,'0.4.1');assert.equal(tools.newer('0.4.1','0.4.0'),true);assert.equal(tools.newer('0.4.0','0.4.1'),false);assert.equal(tools.newer('0.4.1','0.4.1'),false);
 const altered=structuredClone(r);altered.manifest.assets[0].sha256='0'.repeat(64);assert.throws(()=>tools.verify(altered,keys.publicKey),/signature/);
 assert.throws(()=>tools.verify(r,generateKeyPairSync('ed25519').publicKey),/signature/);
 for(const patch of [{url:'https://evil.example/payload.exe'},{bytes:1024**4},{arch:'other'},{sha256:'invalid'}]){const m=structuredClone(r.manifest);Object.assign(m.assets[0],patch);assert.throws(()=>tools.verify(signed(m),keys.publicKey));}
 for(const url of ['http://github.com/file','https://github.com.evil.example/a','https://user@github.com/a','https://github.com:8443/a','file:///tmp/a'])assert.throws(()=>updater.allowedURL(url));
});
async function setup(t){const salt=randomBytes(16).toString('hex'),password='update-test-password',users=['admin','normal'].map(id=>({id,email:id+'@example.test',username:id,salt,hash:scryptSync(password,salt,64).toString('hex')}));const identity={findEmail:async e=>users.find(u=>u.email===e),user:async id=>users.find(u=>u.id===id)},service=createService({identity,updatePublicKey:keys.publicKey,updateAdminEmails:['admin@example.test']});service.server.listen(0,'127.0.0.1');await once(service.server,'listening');t.after(()=>service.close());const url='http://127.0.0.1:'+service.server.address().port;
 async function api(p,method='GET',body,token,headers={}){const r=await fetch(url+p,{method,headers:{...headers,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,...await r.json()};}
 const login=async id=>(await api('/api/login','POST',{email:id+'@example.test',password})).token,admin=await login('admin'),normal=await login('normal');
 const device={id:randomUUID(),identityKey:randomBytes(32).toString('hex'),name:'Owner PC',platform:process.platform,arch:process.arch,appVersion:'0.4.0'};assert.equal((await api('/api/devices','POST',device,normal)).status,200);const headers={'X-SI-Device':device.id,'X-SI-Device-Key':device.identityKey};return {service,api,admin,normal,device,headers,users};
}
test('only configured SI admin can import signed releases and push across the fleet',async t=>{
 const s=await setup(t);for(const endpoint of ['devices','releases'])assert.equal((await s.api('/api/admin/updates/'+endpoint,'GET',null,s.normal)).status,403);
 assert.equal((await s.api('/api/admin/updates/push','POST',{email:'admin@example.test',admin:true,version:'0.4.1',deviceIds:[s.device.id]},s.normal)).status,403);
 assert.equal((await s.api('/api/admin/updates/releases','POST',release(),s.normal)).status,403);
 const bad=release();bad.signature='AAAA';assert.equal((await s.api('/api/admin/updates/releases','POST',bad,s.admin)).status,400);
 assert.equal((await s.api('/api/admin/updates/releases','POST',release(),s.admin)).status,200);
 const push=await s.api('/api/admin/updates/push','POST',{version:'0.4.1',deviceIds:[s.device.id]},s.admin);assert.equal(push.status,200);
 const devices=(await s.api('/api/admin/updates/devices','GET',null,s.admin)).devices;assert.equal(devices[0].online,false);assert.equal(devices[0].update.state,'offered');
 assert.equal((await s.api('/api/updates/current','GET',null,s.normal)).status,403);assert.equal((await s.api('/api/updates/current','GET',null,s.admin,s.headers)).status,403);
 const job=(await s.api('/api/updates/current','GET',null,s.normal,s.headers)).job;assert.equal(job.id,push.jobs[0]);assert.equal(tools.verify(job.envelope,keys.publicKey).version,'0.4.1');
 assert.ok(s.service.db.prepare("SELECT * FROM audit WHERE action='update-pushed:0.4.1'").get());
});
test('restart state requires approval, cancellation prevents installation, and device registration reports installed',async t=>{
 const s=await setup(t);await s.api('/api/admin/updates/releases','POST',release(),s.admin);
 const push=async()=>s.api('/api/admin/updates/push','POST',{version:'0.4.1',deviceIds:[s.device.id]},s.admin);let id=(await push()).jobs[0];
 const status=(state,headers=s.headers)=>s.api('/api/updates/status','POST',{id,state},s.normal,headers);
 assert.equal((await status('installed')).status,409);assert.equal((await status('installing')).status,409);
 assert.equal((await status('downloading')).status,200);assert.equal((await status('ready')).status,200);assert.equal((await status('installing')).status,403);
 await s.api('/api/admin/updates/cancel','POST',{id},s.admin);assert.equal((await status('installing',{...s.headers,'X-SI-Restart-Approved':'yes'})).status,409);assert.equal((await s.api('/api/updates/current','GET',null,s.normal,s.headers)).job,null);
 id=(await push()).jobs[0];await status('downloading');await status('ready');assert.equal((await status('installing',{...s.headers,'X-SI-Restart-Approved':'yes'})).status,200);
 assert.equal((await s.api('/api/admin/updates/cancel','POST',{id},s.admin)).status,409);
 await s.api('/api/devices','POST',{...s.device,appVersion:'0.4.1'},s.normal);assert.equal(s.service.db.prepare('SELECT state FROM update_jobs WHERE id=?').get(id).state,'installed');
 assert.equal((await push()).status,400);
});
test('old clients require manual bootstrap and SI role changes revoke admin rights immediately',async t=>{
 const s=await setup(t);await s.api('/api/admin/updates/releases','POST',release(),s.admin);await s.api('/api/devices','POST',{...s.device,appVersion:'0.3.0'},s.normal);
 assert.match((await s.api('/api/admin/updates/push','POST',{version:'0.4.1',deviceIds:[s.device.id]},s.admin)).error,/manually/);
 s.users[0].email='removed@example.test';assert.equal((await s.api('/api/admin/updates/devices','GET',null,s.admin)).status,403);
});
test('client never quits when the user postpones restart and retains existing portable data',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'si-update-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const dataDir=path.join(root,'SI Remote Data');fs.mkdirSync(dataDir);fs.writeFileSync(path.join(dataDir,'clipboard.enc'),'existing encrypted data');const r=release(),asset=r.manifest.assets[0];fs.writeFileSync(path.join(root,tools.filename(r.manifest.version,process.platform,process.arch)),bytes);
 // Windows/Linux can stage this inert artifact without executing it. macOS extraction is tested on native packages instead.
 if(process.platform==='darwin')return;
 let quits=0,prompts=0;const states=[],job={id:randomUUID(),state:'offered',envelope:r};const instance=updater.createUpdater({app:{getVersion:()=> '0.4.0',quit:()=>quits++},prepare:()=>{},dialog:{showMessageBox:async()=>({response:prompts++===0?0:1})},window:()=>undefined,publicKey:keys.publicKey,root,dataDir,busy:()=>false,identity:()=>({}),request:async(p,m,b)=>{if(p.endsWith('current'))return {job};states.push(b.state);return {ok:true};}});
 await instance.check(true);assert.equal(quits,0);assert.deepEqual(states,['downloading','ready','deferred']);assert.equal(fs.readFileSync(path.join(dataDir,'clipboard.enc'),'utf8'),'existing encrypted data');assert.equal(await updater.matches(path.join(root,tools.filename(r.manifest.version,process.platform,process.arch)),asset),true);
 fs.appendFileSync(path.join(root,tools.filename(r.manifest.version,process.platform,process.arch)),'tampered');assert.equal(await updater.matches(path.join(root,tools.filename(r.manifest.version,process.platform,process.arch)),asset),false);
});
test('busy clients cannot download or restart',async()=>{let quits=0;const instance=updater.createUpdater({app:{getVersion:()=> '0.4.0',quit:()=>quits++},dialog:{showMessageBox:async()=>({response:1})},window:()=>undefined,publicKey:keys.publicKey,root:os.tmpdir(),dataDir:os.tmpdir(),busy:()=>true,identity:()=>({}),request:async p=>{assert.equal(p,'/api/updates/current');return {job:{id:'test',state:'offered',envelope:release()}};}});await instance.check();assert.equal(quits,0);});
test('blocked launch preparation reports failure while the current app stays open',async t=>{
 if(process.platform==='darwin')return;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'si-blocked-launch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const envelope=release(),states=[];fs.writeFileSync(path.join(root,tools.filename('0.4.1',process.platform,process.arch)),bytes);let quits=0;
 const instance=updater.createUpdater({app:{getVersion:()=> '0.4.0',quit:()=>quits++},dialog:{showMessageBox:async()=>({response:0})},window:()=>undefined,publicKey:keys.publicKey,root,dataDir:root,busy:()=>false,identity:()=>({}),prepare:()=>{throw Error('OS approval required')},request:async(p,m,b)=>{if(p.endsWith('current'))return {job:{id:'fixture',state:'offered',envelope}};states.push(b);return {ok:true};}});
 await instance.check(true);assert.equal(quits,0);assert.deepEqual(states.map(s=>s.state),['downloading','failed']);assert.match(states.at(-1).detail,/OS approval/);
});
test('an interrupted installing state can retry without being permanently stuck',async t=>{
 if(process.platform==='darwin')return;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'si-retry-launch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const envelope=release(),states=[];fs.writeFileSync(path.join(root,tools.filename('0.4.1',process.platform,process.arch)),bytes);let quits=0;
 const instance=updater.createUpdater({app:{getVersion:()=> '0.4.0',quit:()=>quits++},dialog:{showMessageBox:async()=>({response:0})},window:()=>undefined,publicKey:keys.publicKey,root,dataDir:root,busy:()=>false,identity:()=>({}),prepare:()=>{},launch:app=>app.quit(),request:async(p,m,b)=>{if(p.endsWith('current'))return {job:{id:'fixture',state:'installing',envelope}};states.push(b.state);return {ok:true};}});
 await instance.check(true);assert.equal(quits,1);assert.deepEqual(states,['failed','downloading','ready','installing']);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'update-last.json'))).active,false);
});
test('existing database devices survive updater schema migration',async t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'si-migrate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'db.sqlite'),db=new DatabaseSync(file);db.exec("CREATE TABLE devices(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,platform TEXT,identity_key TEXT,last_seen INTEGER,unattended INTEGER); INSERT INTO devices VALUES('old','owner','Original PC','linux','key',1,1)");db.close();const s=createService({identity:{},database:file});assert.equal(s.db.prepare('SELECT name FROM devices').get().name,'Original PC');assert.equal(s.db.prepare('SELECT app_version FROM devices').get().app_version,'0.0.0');await s.close();});

test('Mac approval rejection reports a failed offer and hands off locally without quitting',async t=>{if(process.platform==='darwin')return;const root=fs.mkdtempSync(path.join(os.tmpdir(),'si-approval-handoff-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const envelope=release(),states=[];fs.writeFileSync(path.join(root,tools.filename('0.4.1',process.platform,process.arch)),bytes);let quits=0,handoffs=0;const instance=updater.createUpdater({app:{getVersion:()=> '0.4.0',quit:()=>quits++},dialog:{showMessageBox:async()=>({response:0})},window:()=>undefined,publicKey:keys.publicKey,root,dataDir:root,busy:()=>false,identity:()=>({}),prepare:()=>{throw Object.assign(Error('Mac approval required'),{code:'MAC_APPROVAL_REQUIRED',target:'/download/new.app'});},approval:async(_,__,target)=>{assert.equal(target,'/download/new.app');handoffs++;},request:async(p,m,b)=>{if(p.endsWith('current'))return {job:{id:'fixture',state:'offered',envelope}};states.push(b.state);return {ok:true};}});await instance.check(true);assert.equal(quits,0);assert.equal(handoffs,1);assert.equal(states.at(-1),'failed');assert.equal(instance.isInstalling(),false);});
