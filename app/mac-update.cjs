'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
function stageMacUpdate(file,root,version,{run=execFileSync}={}){
 const target=path.join(root,'SI Remote-'+version+'.app');
 if(!fs.existsSync(target)){
  const temp=fs.mkdtempSync(path.join(root,'.si-update-'));
  run('/usr/bin/ditto',['-x','-k',file,temp],{timeout:120000});
  const extracted=path.join(temp,'SI Remote.app');
  run('/usr/bin/codesign',['--verify','--deep','--strict',extracted],{timeout:60000});
  // Set quarantine once, before exposing the staged app. Retrying must not
  // replace the user's existing macOS approval with a new quarantine record.
  run('/usr/bin/xattr',['-w','com.apple.quarantine','0083;'+Math.floor(Date.now()/1000).toString(16)+';ConnectForge;',extracted]);
  fs.renameSync(extracted,target);try{fs.rmdirSync(temp);}catch{}
 }
 run('/usr/bin/codesign',['--verify','--deep','--strict',target],{timeout:60000});
 return target;
}
async function showMacApproval(dialog,window,target,shell){
 const response=await dialog.showMessageBox(window,{type:'info',title:'Mac approval required',message:'Approve this update on this Mac',detail:'The current app is still running. Admin cannot approve macOS security remotely.\n\n1. Show the downloaded app in Finder and try opening it.\n2. If blocked, open System Settings → Privacy & Security and choose Open Anyway for SI Remote, if macOS offers it.\n3. Once approved, open the new app, or return here and choose Check update offers to retry. Sign in with the same SI account if asked.\n\nDownloaded app: '+target,buttons:['Show downloaded app','Open Privacy & Security','Later'],defaultId:2,cancelId:2,noLink:true});
 if(response.response===0)shell.showItemInFolder(target);
 if(response.response===1)await shell.openExternal('x-apple.systempreferences:com.apple.preference.security');
}
module.exports={stageMacUpdate,showMacApproval};
