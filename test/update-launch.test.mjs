import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import launcher from '../app/update-launch.cjs';
test('native relaunch is scheduled before quitting and uses paths as data',()=>{
 for(const platform of ['win32','linux','darwin']){const calls=[],target=path.resolve('folder with spaces','new app');launcher.relaunch({relaunch:o=>calls.push(o),quit:()=>calls.push('quit')},target,platform);assert.equal(calls[1],'quit');assert.deepEqual(calls[0],platform==='darwin'?{execPath:'/usr/bin/open',args:['-n',target]}:{execPath:target,args:[]});}
});
test('a relaunch scheduling failure keeps the current app open',()=>{let quit=false;assert.throws(()=>launcher.relaunch({relaunch:()=>{throw Error('cannot schedule')},quit:()=>quit=true},'/app','linux'),/cannot schedule/);assert.equal(quit,false);});
test('missing target is rejected before quitting',()=>{
 assert.throws(()=>launcher.preflight('/missing','win32',{exists:()=>false}),/missing/);
 launcher.preflight('/new.exe','win32',{exists:()=>true});
});
function linuxFixture(t,blocked){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'si-fuse-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const target=path.join(directory,'new.AppImage');fs.writeFileSync(target,'test image');const calls=[];const run=(command,args,options)=>{calls.push({command,args});if(command==='/sbin/ldconfig')return '';if(command===target){const unpacked=path.join(options.cwd,'squashfs-root');fs.mkdirSync(unpacked);fs.writeFileSync(path.join(unpacked,'AppRun'),'test executable');}if(command==='/usr/bin/unshare'&&blocked)throw Error('User namespaces blocked');};return {target,calls,run};}
test('Linux without FUSE stages extraction mode and keeps sandbox protection',t=>{const s=linuxFixture(t,false);const target=launcher.preflight(s.target,'linux',{run:s.run});assert.equal(path.basename(target),'AppRun');assert.ok(fs.existsSync(target));assert.ok(s.calls.some(c=>c.args.includes('--appimage-extract')));assert.ok(!s.calls.some(c=>c.args.includes('--no-sandbox')));});
test('Linux sandbox restrictions stop the update before quitting',t=>{const s=linuxFixture(t,true);assert.throws(()=>launcher.preflight(s.target,'linux',{run:s.run}),/sandbox setup requires an administrator/);});
test('Mac signature and Gatekeeper approval are required, without changing protections',()=>{
 const calls=[];assert.throws(()=>launcher.preflight('/new.app','darwin',{exists:()=>true,run:(command,args)=>{calls.push({command,args});if(command.endsWith('spctl'))throw Error('rejected');}}),/not approved/);
 assert.equal(calls.length,2);assert.equal(calls[0].command,'/usr/bin/codesign');assert.equal(calls[1].command,'/usr/sbin/spctl');
 launcher.preflight('/new.app','darwin',{exists:()=>true,run:()=>''});
});

