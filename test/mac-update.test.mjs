import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import mac from '../app/mac-update.cjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'si-mac-approval-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[];const run=(command,args)=>{calls.push({command,args});if(command.endsWith('ditto'))fs.mkdirSync(path.join(args.at(-1),'SI Remote.app'));};return {root,calls,run};}
test('Mac staging quarantines a verified app once and preserves local approval on retry',t=>{
 const s=fixture(t),target=mac.stageMacUpdate('/verified.zip',s.root,'0.4.7',{run:s.run});
 assert.ok(fs.existsSync(target));mac.stageMacUpdate('/verified.zip',s.root,'0.4.7',{run:s.run});
 assert.equal(s.calls.filter(c=>c.command.endsWith('ditto')).length,1);
 assert.equal(s.calls.filter(c=>c.command.endsWith('xattr')).length,1);
 const firstSignature=s.calls.findIndex(c=>c.command.endsWith('codesign')),quarantine=s.calls.findIndex(c=>c.command.endsWith('xattr'));
 assert.ok(firstSignature<quarantine);
 assert.ok(s.calls.at(-1).command.endsWith('codesign'));
});
test('an invalid extracted Mac signature is rejected before quarantine or staging',t=>{
 const s=fixture(t);assert.throws(()=>mac.stageMacUpdate('/invalid.zip',s.root,'0.4.7',{run:(command,args)=>{s.run(command,args);if(command.endsWith('codesign'))throw Error('Invalid signature');}}),/Invalid signature/);
 assert.equal(fs.existsSync(path.join(s.root,'SI Remote-0.4.7.app')),false);
 assert.equal(s.calls.some(c=>c.command.endsWith('xattr')),false);
});
test('Mac approval help opens only the user-selected Finder or Settings action',async()=>{
 for(const response of [0,1,2]){const actions=[];await mac.showMacApproval({showMessageBox:async(_,options)=>{assert.equal(options.cancelId,2);assert.match(options.detail,/Admin cannot approve/);assert.match(options.detail,/may not appear until/);return {response};}},undefined,'/download/SI Remote.app',{showItemInFolder:p=>actions.push(p),openPath:async p=>{actions.push(p);return '';}});assert.deepEqual(actions,response===0?['/download/SI Remote.app']:response===1?['/System/Applications/System Settings.app']:[]);}
});
test('Mac approval guide restores a hidden or minimized app before showing its dialog',async()=>{
 const calls=[],window={isDestroyed:()=>false,isMinimized:()=>true,restore:()=>calls.push('restore'),show:()=>calls.push('show'),focus:()=>calls.push('focus')};
 await mac.showMacApproval({showMessageBox:async owner=>{assert.equal(owner,window);calls.push('dialog');return {response:2};}},window,'/download/app',{});
 assert.deepEqual(calls,['restore','show','focus','dialog']);
});
test('Settings launch errors show manual instructions instead of silently disappearing',async()=>{
 for(const reject of [false,true]){const dialogs=[];
 await mac.showMacApproval({showMessageBox:async(_,options)=>{dialogs.push(options);return {response:1};}},undefined,'/download/app',{openPath:async()=>{if(reject)throw Error('Launch failed');return 'Launch failed';}});
 assert.equal(dialogs.length,2);assert.equal(dialogs[1].type,'error');assert.match(dialogs[1].detail,/Apple menu/);assert.match(dialogs[1].detail,/Launch failed/);
 }
});
