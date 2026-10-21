'use strict';
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {verify,newer,filename}=require('./update-manifest.cjs');
const {allowedURL,download,matches}=require('./update-download.cjs');
const {preflight,relaunch}=require('./update-launch.cjs');
const {stageMacUpdate,showMacApproval}=require('./mac-update.cjs');
const locations=require('./update-location.cjs');
function createUpdater({app,dialog,window,request,publicKey,root,dataDir,busy,identity,onProgress=()=>{},prepare=preflight,launch=relaunch,approval=(dialog,window,target)=>showMacApproval(dialog,window,target,require('electron').shell)}){
 let running=false,installing=false,lastOffered=null;
 const current=()=>app.getVersion();
 const receiptFile=path.join(dataDir,'update-last.json');
 async function startup(){
  if(!fs.existsSync(receiptFile)||process.argv.includes('--skip-update-redirect'))return false;
  try{const r=JSON.parse(fs.readFileSync(receiptFile)),m=verify(r.envelope,publicKey),asset=m.assets.find(a=>a.platform===process.platform&&a.arch===process.arch);if(!asset)return false;
   if(current()===m.version){r.active=true;fs.writeFileSync(receiptFile,JSON.stringify(r),{mode:0o600});return false;}
   const storage=locations.receiptRoot(r,root,dataDir),file=path.join(storage,filename(m.version,process.platform,process.arch));let target=process.platform==='darwin'?path.join(storage,'SI Remote-'+m.version+'.app'):file;
   if(!r.active||!newer(m.version,current())||!await matches(file,asset))return false;
   target=prepare(target,process.platform)||target;launch(app,target,process.platform,root,dataDir);return true;
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
   if(job.state==='installing')await status(job,'failed','The previous restart did not finish. Retrying the verified update.');
   if(job.state==='ready')await status(job,'deferred');
   if(job.state==='downloading')await status(job,'deferred');
   await status(job,'downloading');
   const storage=locations.updateRoot(root,dataDir),name=filename(m.version,process.platform,process.arch),file=path.join(storage,name),part=file+'.'+asset.sha256.slice(0,16)+'.part';
   try{if(!fs.existsSync(file)||!await matches(file,asset)){if(fs.existsSync(file))throw Error('A different file already exists at the update destination');await download(asset.url,part,asset,onProgress);fs.renameSync(part,file);}}finally{onProgress({stage:'idle'});}
   let target=file;
   if(process.platform==='linux')fs.chmodSync(file,0o755);
   if(process.platform==='darwin')target=stageMacUpdate(file,storage,m.version);
   target=prepare(target,process.platform)||target;
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
   fs.writeFileSync(receiptFile,JSON.stringify({envelope:job.envelope,active:false,updateRoot:storage}),{mode:0o600});
   launch(app,target,process.platform,root,dataDir);
  }catch(e){installing=false;if(job)await status(job,'failed',e.message).catch(()=>{});if(e.code==='MAC_APPROVAL_REQUIRED')await approval(dialog,window(),e.target);else if(interactive||job)await dialog.showMessageBox(window(),{type:'error',message:'Could not update SI Remote',detail:e.message});}
  finally{running=false;}
 }
 return {check,startup,isInstalling:()=>installing};
}
module.exports={createUpdater,allowedURL,download,matches};
