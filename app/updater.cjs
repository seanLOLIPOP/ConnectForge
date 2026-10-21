'use strict';
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {verify,newer,filename}=require('./update-manifest.cjs');
const {allowedURL,download,matches}=require('./update-download.cjs');
function handoff(target,platform,pid){
 // Script text is fixed. Paths are passed as data, never evaluated as commands.
 let child;if(platform==='win32')child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"Wait-Process -Id ([int]$env:SI_UPDATE_PID) -ErrorAction SilentlyContinue; Start-Process -FilePath $env:SI_UPDATE_TARGET"],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,SI_UPDATE_PID:String(pid),SI_UPDATE_TARGET:target}});
 else child=spawn('/bin/sh',['-c','while kill -0 "$1" 2>/dev/null; do sleep 1; done; if [ "$3" = darwin ]; then exec /usr/bin/open "$2"; else exec "$2"; fi','si-update',String(pid),target,platform],{detached:true,stdio:'ignore'});
 child.on('error',()=>{});child.unref();return child;
}
function createUpdater({app,dialog,window,request,publicKey,root,dataDir,busy,identity,onProgress=()=>{}}){
 let running=false,installing=false,lastOffered=null;
 const current=()=>app.getVersion();
 const receiptFile=path.join(dataDir,'update-last.json');
 async function startup(){
  if(!fs.existsSync(receiptFile)||process.argv.includes('--skip-update-redirect'))return false;
  try{const r=JSON.parse(fs.readFileSync(receiptFile)),m=verify(r.envelope,publicKey),asset=m.assets.find(a=>a.platform===process.platform&&a.arch===process.arch);if(!asset)return false;
   const file=path.join(root,filename(m.version,process.platform,process.arch)),target=process.platform==='darwin'?path.join(root,'SI Remote-'+m.version+'.app'):file;
   if(current()===m.version){r.active=true;fs.writeFileSync(receiptFile,JSON.stringify(r),{mode:0o600});return false;}
   if(!r.active||!newer(m.version,current())||!await matches(file,asset))return false;
   if(process.platform==='darwin')execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',target],{timeout:60000});
   const child=handoff(target,process.platform,process.pid);await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});app.quit();return true;
  }catch{return false;}
 }
 async function status(job,state,detail=''){await request('/api/updates/status','POST',{id:job.id,state,detail},{...identity(),...(state==='installing'?{'X-SI-Restart-Approved':'yes'}:{})});}
 async function get(){return (await request('/api/updates/current','GET',undefined,identity())).job;}
 async function check(interactive=false){
  if(running||installing)return;running=true;
  let job;
  try{
   job=await get();if(!job){if(interactive)await dialog.showMessageBox(window(),{message:'Your app has no pending update offers.',type:'info'});return;}
   const m=verify(job.envelope,publicKey);if(!newer(m.version,current()))return;
   const asset=m.assets.find(a=>a.platform===process.platform&&a.arch===process.arch);if(!asset)throw Error('This release has no compatible download');
   if(!interactive&&(lastOffered===job.id||job.state!=='offered'))return;
   if(busy()){if(interactive)throw Error('Finish the remote session before updating');return;}
   lastOffered=job.id;
   const response=await dialog.showMessageBox(window(),{type:'info',title:'SI Remote update',message:'Update to SI Remote '+m.version+'?',detail:'Your administrator offered this update. Download it now, then choose when to restart. Your account and saved clipboard history stay in place.',buttons:['Download update','Later','Decline'],defaultId:1,cancelId:1,noLink:true});
   if(response.response!==0){await status(job,response.response===2?'declined':'deferred');return;}
   if(job.state==='installing')throw Error('A previous restart is still pending. Restart the app or ask your administrator to resend the update.');
   if(job.state==='ready')await status(job,'deferred');
   if(job.state==='downloading')await status(job,'deferred');
   await status(job,'downloading');
   const name=filename(m.version,process.platform,process.arch),file=path.join(root,name),part=file+'.'+asset.sha256.slice(0,16)+'.part';
   try{if(!fs.existsSync(file)||!await matches(file,asset)){if(fs.existsSync(file))throw Error('A different file already exists at the update destination');await download(asset.url,part,asset,onProgress);fs.renameSync(part,file);}}finally{onProgress({stage:'idle'});}
   let target=file;
   if(process.platform==='linux')fs.chmodSync(file,0o755);
   if(process.platform==='darwin'){
    target=path.join(root,'SI Remote-'+m.version+'.app');
    if(!fs.existsSync(target)){
     const temp=fs.mkdtempSync(path.join(root,'.si-update-'));
     // The ZIP is signed by the release publisher. It is extracted only into a new folder.
     execFileSync('/usr/bin/ditto',['-x','-k',file,temp],{timeout:120000});const extracted=path.join(temp,'SI Remote.app');
     execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',extracted],{timeout:60000});
     fs.renameSync(extracted,target);try{fs.rmdirSync(temp);}catch{}
    }
    execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',target],{timeout:60000});
    execFileSync('/usr/bin/xattr',['-w','com.apple.quarantine','0083;'+Math.floor(Date.now()/1000).toString(16)+';ConnectForge;',target]);
   }
   await status(job,'ready');
   const confirm=await dialog.showMessageBox(window(),{type:'question',title:'Update ready',message:'Restart into SI Remote '+m.version+' now?',detail:'The download passed signature and checksum verification. The current app stays available as a backup. On macOS, system approval may also be required.',buttons:['Restart now','Later'],defaultId:1,cancelId:1,noLink:true});
   if(confirm.response!==0){await status(job,'deferred');return;}
   if(busy())throw Error('A remote session started. Finish it before restarting');
   const fresh=await get();if(!fresh||fresh.id!==job.id)throw Error('This update was cancelled or replaced');
   verify(fresh.envelope,publicKey);if(!await matches(file,asset))throw Error('The update download changed');
   installing=true;
   // Lock out new sessions before the final server acknowledgement.
   if(busy())throw Error('A remote session started. Finish it before restarting');
   await status(job,'installing');
   fs.writeFileSync(receiptFile,JSON.stringify({envelope:job.envelope,active:false}),{mode:0o600});
   const child=handoff(target,process.platform,process.pid);
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});app.quit();
  }catch(e){installing=false;if(job)await status(job,'failed',e.message).catch(()=>{});if(interactive||job)await dialog.showMessageBox(window(),{type:'error',message:'Could not update SI Remote',detail:e.message});}
  finally{running=false;}
 }
 return {check,startup,isInstalling:()=>installing};
}
module.exports={createUpdater,allowedURL,download,matches,handoff};

