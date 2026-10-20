import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
const {createClipboardHistory,MAX_ITEMS}=createRequire(import.meta.url)('../app/clipboard.cjs');
function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'si-clipboard-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let value='before session',reads=0;const events=[],key=randomBytes(32);
  const storage={available:()=>true,encrypt(text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},decrypt(data){const d=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAuthTag(data.subarray(12,28));return Buffer.concat([d.update(data.subarray(28)),d.final()]).toString();}};
  const clipboard={readText:async()=>{reads++;return value;},writeText:async text=>{value=text;},availableFormats:async()=>[]};
  const options={clipboard,storage,directory,onLocal:b=>events.push(b)};
  return {options,history:createClipboardHistory(options),events,set:text=>{value=text;},get:()=>value,reads:()=>reads,directory};
}
test('clipboard is unread while disabled and pre-session copies are not shared',async t=>{
  const f=fixture(t),h=f.history;h.setOwner('a');h.setSession('s');await h.tick();assert.equal(f.reads(),0);assert.equal(await h.receive('s','unwanted'),false);
  await h.setEnabled('s',true);await h.tick();assert.equal(f.events.length,0);f.set('new copy');await h.tick();assert.equal(f.events[0].text,'new copy');h.setSession(null);f.set('after disconnect');const n=f.reads();await h.tick();assert.equal(f.reads(),n);assert.equal(await h.receive('s','stale'),false);
});
test('remote copies do not echo back and stale sessions cannot write the OS clipboard',async t=>{
  const f=fixture(t),h=f.history;h.setOwner('a');h.setSession('s');await h.setEnabled('s',true);assert.equal(await h.receive('other','bad'),false);assert.equal(await h.receive('s','remote text'),true);await h.tick();assert.equal(f.get(),'remote text');assert.equal(f.events.length,0);assert.equal(h.snapshot().entries[0].text,'remote text');assert.equal(await h.receive('s','flood'),false);
});
test('history persists encrypted and stays isolated between accounts',async t=>{
  const f=fixture(t),h=f.history;h.setOwner('a');h.setSession('s');await h.setEnabled('s',true);f.set('private saved copy');await h.tick();const files=fs.readdirSync(f.directory);assert.equal(files.length,1);assert.equal(fs.readFileSync(path.join(f.directory,files[0])).includes(Buffer.from('private saved copy')),false);
  const restored=createClipboardHistory(f.options);restored.setOwner('a');assert.equal(restored.snapshot().entries[0].text,'private saved copy');restored.setOwner('b');assert.equal(restored.snapshot().entries.length,0);restored.setOwner(null);await assert.rejects(restored.copy('nope'),/Sign in/);
});
test('history is bounded and rejected oversized text is neither stored nor sent',async t=>{
  const f=fixture(t),h=f.history;h.setOwner('a');h.setSession('s');await h.setEnabled('s',true);for(let i=0;i<MAX_ITEMS+5;i++){f.set('item '+i);await h.tick();}assert.equal(h.snapshot().entries.length,MAX_ITEMS);const count=f.events.length;f.set('x'.repeat(16385));await h.tick();assert.equal(f.events.length,count);assert.equal(await h.receive('s','😀'.repeat(5000)),false);h.clear();assert.equal(h.snapshot().entries.length,0);assert.equal(fs.readdirSync(f.directory).length,0);
});
test('without secure OS storage history remains in memory only',async t=>{
  const f=fixture(t);f.options.storage.available=()=>false;const h=f.history;h.setOwner('a');h.setSession('s');await h.setEnabled('s',true);f.set('memory only');await h.tick();assert.equal(h.snapshot().persistent,false);assert.equal(h.snapshot().entries.length,1);assert.equal(fs.readdirSync(f.directory).length,0);
});
test('a clipboard read finishing after disconnect cannot store or send text',async t=>{
  const f=fixture(t),h=f.history;h.setOwner('a');h.setSession('s');await h.setEnabled('s',true);
  let finish;f.options.clipboard.readText=()=>new Promise(resolve=>{finish=resolve;});
  const pending=h.tick();while(!finish)await new Promise(resolve=>setImmediate(resolve));h.setSession(null);finish('late private copy');await pending;assert.equal(f.events.length,0);assert.equal(h.snapshot().entries.length,0);
});
test('OS concealed clipboard markers are never shared',async t=>{
  const f=fixture(t),h=f.history;h.setOwner('a');h.setSession('s');await h.setEnabled('s',true);f.set('concealed copy');f.options.clipboard.has=async type=>type.includes('ConcealedType');const reads=f.reads();await h.tick();assert.equal(f.reads(),reads);assert.equal(f.events.length,0);
});
test('an encryption failure never writes plaintext and allows memory-only sharing',async t=>{
  const f=fixture(t),h=f.history;f.options.storage.encrypt=()=>{throw Error('Keychain locked');};h.setOwner('a');h.setSession('s');await h.setEnabled('s',true);f.set('new copy');await h.tick();assert.equal(h.snapshot().persistent,false);assert.equal(f.events.length,1);assert.equal(fs.readdirSync(f.directory).length,0);
});
