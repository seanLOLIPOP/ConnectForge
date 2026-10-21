'use strict';
const {app,BrowserWindow,ipcMain,desktopCapturer,screen,session,safeStorage,Tray,Menu,nativeImage,systemPreferences,clipboard,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),https=require('node:https'),crypto=require('node:crypto');
const WebSocket=require('ws');const {createInput}=require('./input.cjs');
const {createCloudflare}=require('./cloudflare.cjs');
const {createClipboardHistory}=require('./clipboard.cjs');
const {createUpdater}=require('./updater.cjs');
const {createPointerReceiver}=require('./latency.js');
const assets=path.join(__dirname,'..','assets'),defaults=JSON.parse(fs.readFileSync(path.join(assets,'server.json'),'utf8'));
const launchPath=name=>{const value=process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);return value&&path.isAbsolute(value)?value:undefined;};
const portableRoot=launchPath('si-remote-profile')||process.env.SI_REMOTE_PROFILE||process.env.PORTABLE_EXECUTABLE_DIR||(process.env.APPIMAGE?path.dirname(process.env.APPIMAGE):app.isPackaged?(process.platform==='darwin'?path.resolve(process.execPath,'../../../..'):path.dirname(process.execPath)):path.join(__dirname,'..'));
let portable=true,dataDir=launchPath('si-remote-data-dir')||process.env.SI_REMOTE_DATA_DIR||path.join(portableRoot,'SI Remote Data');
portable=path.resolve(dataDir)===path.resolve(portableRoot,'SI Remote Data');
try{fs.mkdirSync(dataDir,{recursive:true,mode:0o700});fs.accessSync(dataDir,fs.constants.W_OK);}catch{portable=false;dataDir=path.join(app.getPath('appData'),'SI Remote');fs.mkdirSync(dataDir,{recursive:true,mode:0o700});}
app.setPath('userData',dataDir);
const configFile=path.join(dataDir,'settings.json'),tokenFile=path.join(dataDir,'session.enc');
let config={deviceId:crypto.randomUUID(),identityKey:crypto.randomBytes(32).toString('hex'),name:os.hostname(),unattended:false,server:defaults.url};
try{config={...config,...JSON.parse(fs.readFileSync(configFile,'utf8'))};}catch{}
if(!/^https:\/\//.test(config.server))config.server=defaults.url;
if(config.server==='https://192.168.4.68:8443'&&defaults.tunnelHostname)config.server=defaults.url;
if(!app.isPackaged&&process.env.SI_REMOTE_TEST_SERVER)config.server=process.env.SI_REMOTE_TEST_SERVER;
const save=()=>{fs.writeFileSync(configFile,JSON.stringify(config,null,2),{mode:0o600});};save();
const caFile=path.join(assets,'server-ca.pem'),ca=fs.existsSync(caFile)?fs.readFileSync(caFile):undefined;
let win,tray,socket,token=null,user=null,devices=[],iceServers=[],relayAvailable=false,input,hostSession=null,viewerSession=null,pendingHost=null,selectedSource=null,heartbeat,reconnectTimer,quitting=false;
let pointerInput,inputBounds=null;
const cloudflare=createCloudflare({packaged:app.isPackaged,resourcesPath:process.resourcesPath});let serviceURL=config.server,iceReady=Promise.resolve();
const clipboardHistory=createClipboardHistory({clipboard,storage:{available:secureStorage,encrypt:text=>safeStorage.encryptString(text),decrypt:data=>safeStorage.decryptString(data)},directory:dataDir,onLocal:b=>emit('clipboard-local',b),onChange:b=>emit('clipboard-history',b)});
const updater=createUpdater({app,dialog,window:()=>win,request,publicKey:fs.readFileSync(path.join(assets,'update-public.pem')),root:portableRoot,dataDir,onProgress:p=>{emit('update-progress',p);if(win&&!win.isDestroyed())win.setProgressBar(p.stage==='idle'?-1:p.stage==='verifying'?1:p.received/p.total);},busy:()=>!!(hostSession||viewerSession||pendingHost),identity:()=>({'X-SI-Device':config.deviceId,'X-SI-Device-Key':config.identityKey})});
async function apiTransport(){if(config.server===defaults.url&&defaults.tunnelHostname){const port=await cloudflare.bridge(defaults.tunnelHostname);serviceURL='https://127.0.0.1:'+port;}return serviceURL;}
async function prepareIce(b){const host=b.cloudflareRelayHost||((config.server===defaults.url)?defaults.relayTunnelHostname:null);let servers=b.iceServers||[];if(host){const port=await cloudflare.bridge(host);servers=servers.map(server=>{const urls=Array.isArray(server.urls)?server.urls:[server.urls];return urls.some(url=>url.startsWith('turn:'))?{...server,urls:[`turn:127.0.0.1:${port}?transport=tcp`]}:server;});}iceServers=servers;relayAvailable=b.relayAvailable===true;return servers;}
function emit(type,data){if(win&&!win.isDestroyed()){const throttle=!(hostSession||viewerSession);if(win.webContents.backgroundThrottling!==throttle)win.webContents.setBackgroundThrottling(throttle);win.webContents.send('si:event',{type,...data});}}
function secureStorage(){return safeStorage.isEncryptionAvailable()&&!(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text');}
function tlsOptions(){return {ca:ca?[...require('node:tls').rootCertificates,ca]:undefined,minVersion:'TLSv1.2'};}
async function request(endpoint,method='GET',body,extraHeaders={}){
  const backend=await apiTransport();
  return new Promise((resolve,reject)=>{
    const url=new URL(endpoint,backend);const payload=body===undefined?null:JSON.stringify(body);
    const req=https.request(url,{...tlsOptions(),method,headers:{...extraHeaders,...(token?{Authorization:'Bearer '+token}:{}),...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{})}},res=>{
      let text='';res.on('data',c=>{text+=c;if(text.length>1024*1024)req.destroy(Error('Server response too large'));});res.on('end',()=>{try{const b=JSON.parse(text);if(res.statusCode>=400)reject(Error(b.error||'Request failed'));else resolve(b);}catch{reject(Error('Invalid server response'));}});
    });req.setTimeout(10000,()=>req.destroy(Error('The SI server did not respond')));req.on('error',reject);if(payload)req.write(payload);req.end();
  });
}
function send(b){if(socket?.readyState!==WebSocket.OPEN)throw Error('Connection service is offline');socket.send(JSON.stringify(b));}
function stopHost(){clipboardHistory.setSession(null);input?.release();pointerInput?.reset();inputBounds=null;hostSession=null;selectedSource=null;emit('stop-host',{});updateTray();}
function endAll(){if(hostSession)try{send({type:'end',session:hostSession});}catch{}if(viewerSession)try{send({type:'end',session:viewerSession});}catch{}stopHost();viewerSession=null;emit('stop-viewer',{});}
function updateTray(){
  if(!tray)return;tray.setToolTip(hostSession?'SI Remote · Desktop is being controlled':'SI Remote · '+(user?'Signed in':'Signed out'));
  tray.setContextMenu(Menu.buildFromTemplate([{label:hostSession?'Desktop sharing active — open controls':'Open SI Remote',click:()=>{win.show();win.focus();}},{label:config.unattended?'Disable unattended access':'Unattended access is off',enabled:config.unattended,click:async()=>{config.unattended=false;save();endAll();await register().catch(()=>{});emit('state',state());}},{label:'Disconnect all sessions',click:endAll},{type:'separator'},{label:'Quit SI Remote',click:()=>{quitting=true;app.quit();}}]));
}
function state(){return {user,deviceId:config.deviceId,name:config.name,unattended:config.unattended,devices,connected:socket?.readyState===WebSocket.OPEN,server:config.server,portable,dataDir,rememberAvailable:secureStorage(),platform:process.platform,relayAvailable,input:input?.status()||{available:false,error:'Starting'},permissions:process.platform==='darwin'?{screen:systemPreferences.getMediaAccessStatus('screen'),accessibility:systemPreferences.isTrustedAccessibilityClient(false)}:{screen:'unknown',accessibility:true}};}
async function register(){if(!token)return;await request('/api/devices','POST',{id:config.deviceId,identityKey:config.identityKey,name:config.name,platform:process.platform,arch:process.arch,appVersion:app.getVersion(),unattended:config.unattended});}
async function acceptHost(id){
  if(updater.isInstalling())throw Error('The app is restarting for an update');
  await iceReady;
  if(!id||pendingHost!==id)throw Error('This connection request is no longer valid');
  if(hostSession||viewerSession)throw Error('Finish the current session first');
  if(process.platform==='darwin'&&!systemPreferences.isTrustedAccessibilityClient(true))throw Error('Enable SI Remote in System Settings → Privacy & Security → Accessibility');
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1,height:1}});if(!sources.length)throw Error('Screen capture permission is required');
  selectedSource=sources.find(s=>s.display_id===config.displayId)||sources[0];inputBounds=null;pointerInput?.reset();hostSession=id;pendingHost=null;
  send({type:'accept',session:id});emit('start-host',{session:id,sourceName:selectedSource.name,iceServers});updateTray();
}
function connectSocket(){
  clearTimeout(reconnectTimer);if(socket){socket.removeAllListeners();socket.close();}clearInterval(heartbeat);
  socket=new WebSocket(serviceURL.replace(/^https:/,'wss:')+'/signal',tlsOptions());
  socket.on('open',()=>send({type:'auth',token,device:config.deviceId,identityKey:config.identityKey}));
  socket.on('message',async raw=>{try{const b=JSON.parse(raw);if(b.type==='ready'){iceReady=prepareIce(b);await iceReady;heartbeat=setInterval(()=>{try{send({type:'heartbeat'});}catch{}},20000);emit('state',state());}
    else if(b.type==='devices'){devices=b.devices;emit('devices',{devices});}
    else if(b.type==='update-available'){updater.check().catch(()=>{});}
    else if(b.type==='incoming'){
      if(updater.isInstalling()){send({type:'end',session:b.session});return;}
      pendingHost=b.session;
      if(config.unattended)acceptHost(b.session).catch(e=>{emit('error',{message:e.message});try{send({type:'end',session:b.session});}catch{}});
      else{win.show();emit('incoming',b);}
    }else if(b.type==='connecting'){if(updater.isInstalling()){send({type:'end',session:b.session});return;}viewerSession=b.session;emit('connecting',b);}
    else if(b.type==='ended'){clipboardHistory.setSession(null);if(pendingHost===b.session)pendingHost=null;if(hostSession===b.session)stopHost();if(viewerSession===b.session)viewerSession=null;emit('ended',b);}
    else if(b.type==='signal'){if(b.session===hostSession||b.session===viewerSession)emit('signal',b);}
    else if(b.type==='accepted'){if(b.session===viewerSession){await prepareIce(b);emit('accepted',{...b,iceServers});}}
    else if(b.type==='error')emit('error',{message:b.message});
  }catch(e){emit('error',{message:e.message||'Could not process connection message'});}});
  socket.on('error',e=>emit('error',{message:e.message}));socket.on('close',(code,reason)=>{clearInterval(heartbeat);endAll();emit('state',state());if(!quitting&&token){if(code===1008||String(reason)==='Device removed'){token=null;user=null;clipboardHistory.setOwner(null);fs.rmSync(tokenFile,{force:true});emit('state',state());}else reconnectTimer=setTimeout(async()=>{try{await request('/api/me');await register();connectSocket();}catch(e){emit('error',{message:e.message});}},5000);}});
}
const trusted=event=>win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame;
function handle(name,fn){ipcMain.handle('si:'+name,async(event,...args)=>{if(!trusted(event))throw Error('Untrusted window');try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message};}});}
handle('fullscreen',enabled=>{if(typeof enabled!=='boolean')throw Error('Invalid fullscreen state');win.setFullScreen(enabled);return enabled;});
handle('state',()=>state());
handle('updates',async()=>{if(!user)throw Error('Sign in to check update offers');await updater.check(true);});
handle('login',async({email,password,remember})=>{
  if(user)throw Error('Sign out before switching accounts');const result=await request('/api/login','POST',{email,password});token=result.token;user=result.user;
  try{if(config.ownerId&&config.ownerId!==user.id){config.deviceId=crypto.randomUUID();config.identityKey=crypto.randomBytes(32).toString('hex');config.unattended=false;}await register();config.ownerId=user.id;save();clipboardHistory.setOwner(user.id);if(remember&&secureStorage())fs.writeFileSync(tokenFile,safeStorage.encryptString(token),{mode:0o600});else fs.rmSync(tokenFile,{force:true});connectSocket();return state();}catch(e){token=null;user=null;throw e;}
});
handle('logout',async()=>{endAll();clearTimeout(reconnectTimer);try{await request('/api/logout','POST',{});}finally{token=null;user=null;clipboardHistory.setOwner(null);devices=[];socket?.close();fs.rmSync(tokenFile,{force:true});config.unattended=false;save();updateTray();}return state();});
handle('settings',async b=>{
  if(typeof b.name!=='string'||b.name.trim().length<1||b.name.length>80)throw Error('Name must be 1–80 characters');
  if(b.unattended===true&&(!user||!input.status().available))throw Error(input.status().error||'Sign in before enabling unattended access');
  config.name=b.name.trim();config.unattended=b.unattended===true;save();if(!config.unattended&&hostSession)endAll();await register();updateTray();return state();
});
handle('connect',id=>{if(updater.isInstalling())throw Error('The app is restarting for an update');if(typeof id!=='string'||!devices.some(d=>d.id===id&&d.id!==config.deviceId&&d.online))throw Error('Choose an online computer');send({type:'connect',device:id});});
handle('approve',id=>acceptHost(id));
handle('signal',b=>{if(!b||![hostSession,viewerSession].filter(Boolean).includes(b.session))throw Error('Session is not active');send({type:'signal',session:b.session,payload:b.payload});});
handle('end',id=>{if(id&&pendingHost===id){send({type:'end',session:id});pendingHost=null;}else if(!id||[hostSession,viewerSession].includes(id)){endAll();}});
handle('remove',async id=>{if(typeof id!=='string'||!devices.some(d=>d.id===id))throw Error('Unknown computer');await request('/api/devices/'+encodeURIComponent(id),'DELETE');});
function hostBounds(){if(inputBounds)return inputBounds;const display=screen.getAllDisplays().find(d=>String(d.id)===selectedSource?.display_id)||screen.getPrimaryDisplay();let bounds=display.bounds;if(process.platform==='win32'){const a=screen.dipToScreenPoint({x:bounds.x,y:bounds.y}),b=screen.dipToScreenPoint({x:bounds.x+bounds.width-1,y:bounds.y+bounds.height-1});bounds={x:a.x,y:a.y,width:b.x-a.x+1,height:b.y-a.y+1};}return inputBounds=bounds;}
handle('input',({session:id,event})=>{if(!hostSession||id!==hostSession)return false;pointerInput.apply(event,hostBounds());if(!app.isPackaged&&process.env.SI_REMOTE_E2E&&event?.kind==='key')fs.appendFileSync(process.env.SI_REMOTE_E2E+'.input',JSON.stringify({kind:event.kind,code:event.code,down:event.down})+'\n');return true;});
handle('release',id=>{if(id===hostSession){input.release();pointerInput.reset();}});
function activeClipboard(id){if(!user||!id||![hostSession,viewerSession].includes(id))throw Error('Clipboard session is not active');clipboardHistory.setSession(id);}
handle('clipboard-list',()=>{if(!user)throw Error('Sign in to use clipboard history');return clipboardHistory.snapshot();});
handle('clipboard-enable',({session:id,enabled})=>{activeClipboard(id);return clipboardHistory.setEnabled(id,enabled);});
handle('clipboard-receive',({session:id,text})=>{activeClipboard(id);return clipboardHistory.receive(id,text);});
handle('clipboard-copy',id=>{if(!user)throw Error('Sign in to use clipboard history');return clipboardHistory.copy(id);});
handle('clipboard-clear',()=>{if(!user)throw Error('Sign in to use clipboard history');clipboardHistory.clear();});
handle('diagnostics',async()=>{
  const checks=[];try{const health=await request('/health');checks.push({name:'SI server',ok:health.ok,detail:config.server});}catch(e){checks.push({name:'SI server',ok:false,detail:e.message});}
  if(token)try{await request('/api/me');checks.push({name:'SI account',ok:true,detail:'Your account is valid'});await register();if(socket?.readyState!==WebSocket.OPEN)connectSocket();checks.push({name:'Device address',ok:true,detail:'Registration refreshed; network addresses are discovered automatically for each connection'});const ice=await request('/api/ice');await prepareIce(ice);checks.push({name:'Relay configured',ok:relayAvailable,detail:relayAvailable?'Authenticated TURN relay configured; reachability is checked during connection':'No relay configured'});}catch(e){checks.push({name:'SI account',ok:false,detail:e.message});}
  checks.push({name:'Remote input',ok:input.status().available,detail:input.status().error||'Native input is ready'});if(process.platform==='darwin')checks.push({name:'macOS Accessibility',ok:systemPreferences.isTrustedAccessibilityClient(true),detail:'Enable Accessibility and Screen Recording in System Settings'});
  emit('state',state());return checks;
});
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{win?.show();win?.focus();});
  app.whenReady().then(async()=>{
    input=createInput();setInterval(()=>clipboardHistory.tick(),500).unref();
    pointerInput=createPointerReceiver((event,bounds)=>input.apply(event,bounds));
    for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,()=>{inputBounds=null;});
    setInterval(()=>{if(user)updater.check().catch(()=>{});},60000).unref();
    session.defaultSession.setPermissionRequestHandler((webContents,permission,callback)=>callback(webContents===win?.webContents&&['media','display-capture','fullscreen'].includes(permission)));
    session.defaultSession.setDisplayMediaRequestHandler(async(req,callback)=>{if(!hostSession||!selectedSource||req.frame!==win.webContents.mainFrame)return callback({});callback({video:selectedSource});},{useSystemPicker:false});
    win=new BrowserWindow({width:1220,height:810,minWidth:920,minHeight:650,backgroundColor:'#0b101b',title:'SI Remote',icon:path.join(assets,'icon.png'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('enter-full-screen',()=>emit('fullscreen',{enabled:true}));win.on('leave-full-screen',()=>emit('fullscreen',{enabled:false}));
    win.on('close',e=>{if(!quitting&&user&&config.unattended){e.preventDefault();win.hide();}});
    const icon=nativeImage.createFromPath(path.join(assets,'icon.png')).resize({width:24,height:24});
    tray=new Tray(icon);updateTray();tray.on('double-click',()=>{win.show();win.focus();});
    await win.loadFile(path.join(__dirname,'index.html'));
    if(await updater.startup())return;
    if(!app.isPackaged&&process.env.SI_REMOTE_E2E)require('../test/electron-harness.cjs')({win,app,fs,screen});
    if(secureStorage()&&fs.existsSync(tokenFile))try{token=safeStorage.decryptString(fs.readFileSync(tokenFile));user=(await request('/api/me')).user;clipboardHistory.setOwner(user.id);await register();connectSocket();emit('state',state());}catch(e){token=null;user=null;fs.rmSync(tokenFile,{force:true});emit('error',{message:'Sign in again: '+e.message});}
    if(process.env.SI_REMOTE_SMOKE){setTimeout(async()=>{try{await win.capturePage().then(img=>fs.writeFileSync(process.env.SI_REMOTE_SMOKE,img.toPNG()));fs.writeFileSync(process.env.SI_REMOTE_SMOKE+'.json',JSON.stringify(state(),null,2));quitting=true;app.quit();}catch(e){console.error(e);app.exit(1);}},2500);}
  });
  app.on('before-quit',()=>{quitting=true;clearTimeout(reconnectTimer);clearInterval(heartbeat);endAll();socket?.close();cloudflare.stop();});
  app.on('window-all-closed',()=>{if(!config.unattended)app.quit();});
}
