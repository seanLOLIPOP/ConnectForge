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
 if(window&&!window.isDestroyed?.()){if(window.isMinimized?.())window.restore();window.show();window.focus();}
 const response=await dialog.showMessageBox(window,{type:'info',title:'Mac approval required',message:'Open the downloaded app before checking Security',detail:'The current app is still running. Admin cannot approve macOS security remotely.\n\n1. Click Show downloaded app, then double-click the new app in Finder. If macOS blocks it, dismiss the warning without moving the app to Trash.\n2. Open System Settings, select Privacy & Security in the sidebar, and scroll down to Security. Choose Open Anyway for SI Remote if macOS offers it. The entry may not appear until you have tried opening that exact downloaded app.\n3. After approval, return here and choose This computer → Check update offers to retry. For manual opening, quit this current SI Remote app first, then open the downloaded new app. Sign in with the same SI account if asked.\n\nIf there is no Open Anyway entry after opening the download, note the exact macOS warning. Approval is not guaranteed for every warning.\n\nDownloaded app: '+target,buttons:['Show downloaded app','Open System Settings','Later'],defaultId:2,cancelId:2,noLink:true});
 if(response.response===0)shell.showItemInFolder(target);
 if(response.response===1){
  let error;try{error=await shell.openPath('/System/Applications/System Settings.app');}catch(e){error=e.message||String(e);}
  if(error)await dialog.showMessageBox(window,{type:'error',title:'Open System Settings manually',message:'System Settings could not be opened',detail:'Use Apple menu → System Settings → Privacy & Security, then scroll down to Security. Try opening the downloaded app in Finder first if Open Anyway is missing.\n\n'+error,buttons:['OK'],noLink:true});
 }
}
module.exports={stageMacUpdate,showMacApproval};
