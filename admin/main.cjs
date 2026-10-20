'use strict';
const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),https=require('node:https');
const {createCloudflare}=require('../app/cloudflare.cjs'),{verify,version}=require('../app/update-manifest.cjs'),{allowedURL}=require('../app/updater.cjs');
const assets=path.join(__dirname,'../assets'),defaults=JSON.parse(fs.readFileSync(path.join(assets,'server.json'))),ca=fs.readFileSync(path.join(assets,'server-ca.pem')),publicKey=fs.readFileSync(path.join(assets,'update-public.pem'));
app.setPath('userData',path.join(app.getPath('appData'),'SI Remote Admin'));let win,token=null,user=null;
const cloudflare=createCloudflare({packaged:app.isPackaged,resourcesPath:process.resourcesPath});
async function request(endpoint,method='GET',body){
 let base=defaults.url;if(defaults.tunnelHostname)base='https://127.0.0.1:'+await cloudflare.bridge(defaults.tunnelHostname);
 return new Promise((resolve,reject)=>{const payload=body===undefined?null:JSON.stringify(body),req=https.request(new URL(endpoint,base),{method,ca:[...require('node:tls').rootCertificates,ca],minVersion:'TLSv1.2',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{})}},res=>{let data='';res.on('data',b=>{data+=b;if(data.length>1024*1024)req.destroy(Error('Response too large'));});res.on('error',reject);res.on('end',()=>{try{const b=JSON.parse(data);if(res.statusCode>=400)reject(Error(b.error||'Request failed'));else resolve(b);}catch{reject(Error('Invalid response'));}});});req.setTimeout(15000,()=>req.destroy(Error('Server did not respond')));req.on('error',reject);if(payload)req.write(payload);req.end();});
}
function fetchManifest(url,n=0){if(n>5)throw Error('Too many redirects');const u=allowedURL(url);return new Promise((resolve,reject)=>{const req=https.get(u,{headers:{'User-Agent':'ConnectForge-Admin'}},res=>{if([301,302,303,307,308].includes(res.statusCode)){res.resume();try{resolve(fetchManifest(new URL(res.headers.location,u).href,n+1));}catch(e){reject(e);}return;}if(res.statusCode!==200){res.resume();reject(Error('Signed release manifest is not available ('+res.statusCode+')'));return;}let text='';res.on('data',b=>{text+=b;if(text.length>14000)req.destroy(Error('Manifest is too large'));});res.on('error',reject);res.on('end',()=>{try{const b=JSON.parse(text);verify(b,publicKey);resolve(b);}catch(e){reject(e);}});});req.setTimeout(15000,()=>req.destroy(Error('GitHub did not respond')));req.on('error',reject);});}
function handle(name,fn){ipcMain.handle('admin:'+name,async(e,...args)=>{if(e.sender!==win?.webContents||e.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted window');try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message};}});}
handle('login',async b=>{if(token)throw Error('Sign out first');const r=await request('/api/login','POST',{email:b.email,password:b.password});token=r.token;try{if(!(await request('/api/admin/updates/role')).allowed)throw Error('This SI account is not an update administrator');user=r.user;return user;}catch(e){await request('/api/logout','POST',{}).catch(()=>{});token=null;throw e;}});
handle('logout',async()=>{try{await request('/api/logout','POST',{});}finally{token=null;user=null;}});
handle('refresh',async()=>{if(!user)throw Error('Sign in first');return {devices:(await request('/api/admin/updates/devices')).devices,releases:(await request('/api/admin/updates/releases')).releases};});
handle('import',async v=>{if(!user)throw Error('Sign in first');version(v);const envelope=await fetchManifest('https://github.com/seanLOLIPOP/ConnectForge/releases/download/v'+v+'/update-manifest.json');return request('/api/admin/updates/releases','POST',envelope);});
handle('push',async b=>{if(!user)throw Error('Sign in first');return request('/api/admin/updates/push','POST',b);});
handle('cancel',async id=>{if(!user)throw Error('Sign in first');return request('/api/admin/updates/cancel','POST',{id});});
if(!app.requestSingleInstanceLock())app.quit();else app.whenReady().then(async()=>{
 win=new BrowserWindow({width:1160,height:800,minWidth:900,minHeight:600,title:'SI Remote Admin',backgroundColor:'#0b101b',autoHideMenuBar:true,icon:path.join(assets,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());await win.loadFile(path.join(__dirname,'index.html'));
 if(process.env.SI_ADMIN_SMOKE)setTimeout(async()=>{await win.capturePage().then(img=>fs.writeFileSync(process.env.SI_ADMIN_SMOKE,img.toPNG()));app.quit();},2500);
});
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{cloudflare.stop();});
