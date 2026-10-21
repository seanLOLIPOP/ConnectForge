'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
function preflight(target,platform,{run=execFileSync,exists=fs.existsSync}={}){
 if(!exists(target))throw Error('The downloaded app is missing. Download the update again.');
 if(platform==='darwin'){
  run('/usr/bin/codesign',['--verify','--deep','--strict',target],{timeout:60000});
  try{run('/usr/sbin/spctl',['--assess','--type','execute',target],{timeout:30000,stdio:'pipe'});}catch{throw Object.assign(Error('Mac approval required on the target computer. macOS has not approved this downloaded app. The current app will stay open. Use the local approval dialog to reveal the new app and open Privacy & Security. Unattended Mac updates require Developer ID signing and Apple notarization.'),{code:'MAC_APPROVAL_REQUIRED',target});}
 }
 if(platform==='linux'&&target.endsWith('.AppImage')){
  {
   const temp=fs.mkdtempSync(path.join(path.dirname(target),'.si-linux-update-'));
   run(target,['--appimage-extract'],{cwd:temp,timeout:120000,stdio:'pipe'});
   const directory=path.join(temp,'squashfs-root'),entry=path.join(directory,'AppRun');
   if(!exists(entry))throw Error('The Linux update did not extract correctly. The current app will stay open.');
   linuxSandbox(directory,run);
   return entry;
  }
 }
 return target;
}
function linuxSandbox(directory,run){
 const helper=path.join(directory,'chrome-sandbox'),previous=path.join(path.dirname(process.execPath),'chrome-sandbox');
 const approved=file=>{try{const s=fs.statSync(file);return s.uid===0&&(s.mode&0o4777)===0o4755;}catch{return false;}};
 if(approved(helper))return;
 for(const candidate of [previous,process.env.CHROME_DEVEL_SANDBOX]){
  if(candidate&&approved(candidate)&&fs.existsSync(helper)&&crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex')===crypto.createHash('sha256').update(fs.readFileSync(helper)).digest('hex')){
   const stable=fs.realpathSync(candidate);
   if(stable.startsWith('/tmp/')||stable.startsWith('/run/'))continue;
   // Chromium validates the helper beside its executable. The environment
   // variable alone does not override that check in this Electron runtime.
   fs.renameSync(helper,helper+'.bundled');fs.symlinkSync(stable,helper);
   return;
  }
 }
 try{run('/usr/bin/unshare',['--user','--map-root-user','/usr/bin/true'],{timeout:10000,stdio:'pipe'});}catch{throw Error('The update was extracted without FUSE, but Chromium sandbox setup requires an administrator on this Linux system. The current app will stay open. Prepare the sandbox in '+directory+' before opening that extracted app, or use the tar.gz download. The sandbox has not been disabled.');}
}
function relaunch(app,target,platform,root,dataDir){
 // Electron's native relauncher waits for this process to exit. Avoid detached
 // PowerShell/shell helpers whose launch errors were previously discarded.
 const options=platform==='darwin'?{execPath:'/usr/bin/open',args:['-n',target]}:{execPath:path.resolve(target),args:[]};
 if(platform==='darwin'&&(root||dataDir)){options.args.push('--args');if(root)options.args.push('--si-remote-profile='+path.resolve(root));if(dataDir)options.args.push('--si-remote-data-dir='+path.resolve(dataDir));}
 if(root)process.env.SI_REMOTE_PROFILE=path.resolve(root);
 if(dataDir)process.env.SI_REMOTE_DATA_DIR=path.resolve(dataDir);
 app.relaunch(options);
 app.quit();
}
module.exports={preflight,relaunch};
