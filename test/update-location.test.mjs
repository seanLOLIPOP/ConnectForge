import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import location from '../app/update-location.cjs';
test('writable portable folders retain update storage beside the app and leave no probe files',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'si-location-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.equal(location.updateRoot(root,path.join(root,'data')),root);assert.deepEqual(fs.readdirSync(root),[]);
});
test('read-only or denied app folders use a tested writable folder inside existing data',()=>{
 for(const code of ['EROFS','EACCES','EPERM','ENOENT']){const calls=[],root=path.resolve('read-only'),data=path.resolve('profile');const result=location.updateRoot(root,data,{check:p=>{calls.push(p);if(p===root)throw Object.assign(Error('blocked'),{code});},mkdir:p=>calls.push('mkdir:'+p)});assert.equal(result,path.join(data,'Updates'));assert.deepEqual(calls,[root,'mkdir:'+result,result]);}
 assert.throws(()=>location.updateRoot('root','data',{check:()=>{throw Object.assign(Error('Disk full'),{code:'ENOSPC'});}}),/Disk full/);
 assert.throws(()=>location.updateRoot('root','data',{check:()=>{throw Object.assign(Error('Denied'),{code:'EROFS'});},mkdir:()=>{throw Error('Fallback denied');}}),/Fallback denied/);
});
test('startup accepts legacy and fallback receipts but rejects unrelated update paths',()=>{
 const root=path.resolve('portable'),data=path.resolve('profile');
 assert.equal(location.receiptRoot({},root,data),root);
 assert.equal(location.receiptRoot({updateRoot:path.join(data,'Updates')},root,data),path.join(data,'Updates'));
 assert.throws(()=>location.receiptRoot({updateRoot:path.resolve('other')},root,data),/Invalid update/);
});
