'use strict';
const $=id=>document.getElementById(id);let state=null,current=null,pendingIncoming=null,toastTimer,statsTimer;
const platform=p=>({win32:'Windows',darwin:'macOS',linux:'Linux'}[p]||p);
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
const attempt=fn=>async(...args)=>{try{return await fn(...args);}catch(e){toast(e.message);}};
function page(name){$('computers-page').hidden=name!=='computers';$('settings-page').hidden=name!=='settings';$('nav-computers').classList.toggle('active',name==='computers');$('nav-settings').classList.toggle('active',name==='settings');$('page-label').textContent=name==='computers'?'MY COMPUTERS':'THIS COMPUTER';}
function render(s){
  state=s;$('login-view').hidden=!!s.user;$('dashboard').hidden=!s.user;$('login-server').textContent='Account server · '+s.server;$('remember').disabled=!s.rememberAvailable;if(!s.rememberAvailable){$('remember').checked=false;$('remember').parentElement.title='A secure OS credential store is unavailable. Sign-in will last for this run only.';}
  if(!s.user)return;
  $('username').textContent=s.user.username;$('avatar').textContent=(s.user.username||'S')[0].toUpperCase();$('local-name').textContent=s.name;
  $('local-detail').textContent=platform(s.platform)+' · '+(s.unattended?'Unattended access enabled':'Approval required for incoming connections');$('setup-button').textContent=s.unattended?'Manage access →':'Set up access →';
  $('server-status').lastElementChild.textContent=s.connected?'Connected to SI':'Reconnecting to SI…';$('computer-name').value=s.name;$('unattended').checked=s.unattended;
  $('input-status').textContent=s.input.available?'Keyboard and mouse control: ready':'Keyboard and mouse control: '+s.input.error;
  $('permissions-status').textContent=s.platform==='darwin'?'Screen Recording: '+s.permissions.screen+' · Accessibility: '+(s.permissions.accessibility?'allowed':'permission required'):'';
  $('storage-location').textContent=(s.portable?'Portable data folder: ':'Using OS data folder because the app folder is not writable: ')+s.dataDir;
  renderDevices(s.devices||[]);
}
function renderDevices(devices){
  if(!state)return;state.devices=devices;const remote=devices.filter(d=>d.id!==state.deviceId);$('device-count').textContent=devices.length;$('online-count').textContent=remote.filter(d=>d.online).length+' online';$('empty').hidden=remote.length>0;$('device-grid').replaceChildren();
  for(const d of remote){
    const card=document.createElement('article');card.className='device';const top=document.createElement('div');top.className='device-top';const icon=document.createElement('span');icon.className='device-icon';icon.textContent=d.platform==='darwin'?'⌘':d.platform==='linux'?'◇':'▣';const badge=document.createElement('span');badge.className='badge'+(d.online?'':' offline');badge.textContent=d.online?'● Online':'Offline';top.append(icon,badge);
    const name=document.createElement('h3');name.textContent=d.name;const info=document.createElement('p');info.textContent=platform(d.platform)+' · '+(d.unattended?'Ready for unattended access':'Approval required');const actions=document.createElement('div');actions.className='device-actions';const connect=document.createElement('button');connect.className='secondary';connect.textContent=d.online?'Connect →':'Offline';connect.disabled=!d.online;connect.onclick=attempt(async()=>{if(current)throw Error('Disconnect the current session first');$('viewer-name').textContent=d.name;$('viewer').hidden=false;$('viewer-message').hidden=false;$('viewer-message').textContent='Waiting for the computer…';await window.si.connect(d.id);});
    const remove=document.createElement('button');remove.className='quiet';remove.textContent='Remove';remove.onclick=attempt(async()=>{if(confirm('Remove '+d.name+' from your account? It will need to be registered again.'))await window.si.remove(d.id);});actions.append(connect,remove);card.append(top,name,info,actions);$('device-grid').append(card);
  }
}
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-error').textContent='';$('login-button').disabled=true;try{render(await window.si.login({email:$('email').value,password:$('password').value,remember:$('remember').checked}));$('password').value='';}catch(e){$('login-error').textContent=e.message;}finally{$('login-button').disabled=false;}};
$('logout').onclick=attempt(async()=>{closeLocal();render(await window.si.logout());});
$('nav-computers').onclick=()=>page('computers');$('nav-settings').onclick=$('setup-button').onclick=()=>page('settings');
$('settings-form').onsubmit=attempt(async e=>{e.preventDefault();render(await window.si.settings({name:$('computer-name').value,unattended:$('unattended').checked}));$('save-result').textContent='Saved';setTimeout(()=>$('save-result').textContent='',3000);});
$('fix').onclick=attempt(async()=>{$('diagnostics-results').textContent='Checking your connection…';$('diagnostics-dialog').showModal();const checks=await window.si.diagnostics();$('diagnostics-results').replaceChildren();for(const c of checks){const row=document.createElement('div');row.className='check-result';const title=document.createElement('strong');title.textContent=(c.ok?'✓ ':'! ')+c.name;const detail=document.createElement('p');detail.textContent=c.detail;row.append(title,detail);$('diagnostics-results').append(row);}});
$('close-diagnostics').onclick=()=>$('diagnostics-dialog').close();
$('allow').onclick=attempt(async()=>{const id=pendingIncoming;pendingIncoming=null;$('incoming-dialog').close();await window.si.approve(id);});
$('deny').onclick=attempt(async()=>{if(pendingIncoming)await window.si.end(pendingIncoming);$('incoming-dialog').close();pendingIncoming=null;});
$('incoming-dialog').addEventListener('cancel',e=>{e.preventDefault();$('deny').click();});
// All screen/input traffic uses WebRTC's encrypted media and data channels.
function peer(s,relay=false){
  const pc=new RTCPeerConnection({iceServers:s.iceServers,iceTransportPolicy:relay?'relay':'all'});s.pc=pc;s.candidates=[];s.remoteReady=false;s.relay=relay;
  pc.onicecandidate=e=>{if(e.candidate)window.si.signal({session:s.id,payload:{kind:'candidate',candidate:e.candidate.toJSON()}}).catch(e=>toast(e.message));};
  pc.ontrack=e=>{$('remote-video').srcObject=e.streams[0]||new MediaStream([e.track]);$('viewer-message').hidden=true;};
  pc.ondatachannel=e=>bindChannel(s,e.channel);
  pc.onconnectionstatechange=()=>{
    if(current!==s||s.pc!==pc)return;
    if(pc.connectionState==='connected'){clearTimeout(s.timeout);$('viewer-message').hidden=true;updateStats(s);}
    if(pc.connectionState==='failed')retryRelay(s);
    if(pc.connectionState==='disconnected'){clearTimeout(s.disconnectTimer);s.disconnectTimer=setTimeout(()=>{if(pc.connectionState==='disconnected')retryRelay(s);},8000);}
  };
  if(s.stream)for(const track of s.stream.getTracks())pc.addTrack(track,s.stream);
  clearTimeout(s.timeout);s.timeout=setTimeout(()=>{if(pc.connectionState!=='connected')retryRelay(s);},20000);
  return pc;
}
function bindChannel(s,channel){
  s.channel=channel;channel.onopen=()=>{if(s.role==='viewer'){$('video-area').focus();$('viewer-message').hidden=true;}};
  let count=0,windowStart=performance.now();channel.onmessage=e=>{
    if(s.role!=='host'||current!==s||typeof e.data!=='string'||e.data.length>1024)return;
    if(performance.now()-windowStart>1000){count=0;windowStart=performance.now();}if(++count>300)return;
    try{const event=JSON.parse(e.data);if(event.kind==='release')window.si.release(s.id);else window.si.input({session:s.id,event});}catch{}
  };
  channel.onclose=()=>{if(s.role==='host')window.si.release(s.id);};
}
async function startHost(b){
  closeLocal();const s=current={id:b.session,role:'host',iceServers:b.iceServers,stream:null,channel:null};peer(s);$('sharing-banner').hidden=false;
  s.ready=(async()=>{
    const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:24,max:30},width:{max:1920},height:{max:1080}},audio:false});
    if(current!==s){stream.getTracks().forEach(t=>t.stop());return;}
    s.stream=stream;for(const t of stream.getTracks()){s.pc.addTrack(t,stream);t.onended=()=>window.si.end(s.id);}
  })();
  try{await s.ready;}catch(e){toast('Could not share this screen: '+e.message);await window.si.end(s.id);closeLocal();}
}
async function startViewer(b){
  const s=current={id:b.session,role:'viewer',iceServers:b.iceServers,relayAvailable:b.relayAvailable,stream:null,channel:null};$('viewer').hidden=false;await offer(s,false);
}
async function offer(s,relay){
  if(s.pc){s.pc.onconnectionstatechange=null;s.pc.close();}const pc=peer(s,relay);bindChannel(s,pc.createDataChannel('input',{ordered:true}));pc.addTransceiver('video',{direction:'recvonly'});
  await pc.setLocalDescription(await pc.createOffer());await window.si.signal({session:s.id,payload:{kind:'offer',description:pc.localDescription.toJSON()}});
}
async function signal(b){
  const s=current;if(!s||s.id!==b.session)return;const p=b.payload;
  if(p.kind==='restart'&&s.role==='host'){await s.ready;if(s.pc){s.pc.onconnectionstatechange=null;s.pc.close();}peer(s,p.relay===true);return;}
  if(p.kind==='candidate'){if(s.remoteReady)await s.pc.addIceCandidate(p.candidate);else s.candidates.push(p.candidate);return;}
  if(p.kind==='offer'&&s.role==='host'){
    await s.ready;if(current!==s)return;const pc=s.pc;await pc.setRemoteDescription(p.description);s.remoteReady=true;for(const c of s.candidates)await pc.addIceCandidate(c);s.candidates=[];await pc.setLocalDescription(await pc.createAnswer());await window.si.signal({session:s.id,payload:{kind:'answer',description:pc.localDescription.toJSON()}});
    for(const sender of pc.getSenders()){if(sender.track?.kind==='video'){const params=sender.getParameters();if(params.encodings?.length){params.encodings[0].maxBitrate=6000000;await sender.setParameters(params).catch(()=>{});}}}return;
  }
  if(p.kind==='answer'&&s.role==='viewer'){await s.pc.setRemoteDescription(p.description);s.remoteReady=true;for(const c of s.candidates)await s.pc.addIceCandidate(c);s.candidates=[];}
}
async function retryRelay(s){
  if(current!==s||s.retrying||s.role!=='viewer')return;s.retrying=true;
  try{if(!s.relay&&s.relayAvailable){$('route').textContent='Trying encrypted relay…';await window.si.signal({session:s.id,payload:{kind:'restart',relay:true}});await offer(s,true);}
  else{toast('Could not reach this computer. Check its network and try Auto-fix connection.');await window.si.end(s.id);closeLocal();}}finally{s.retrying=false;}
}
async function updateStats(s){
  clearInterval(statsTimer);statsTimer=setInterval(async()=>{if(!s.pc||current!==s)return;try{const stats=await s.pc.getStats();let pair;stats.forEach(r=>{if(r.type==='transport'&&r.selectedCandidatePairId)pair=stats.get(r.selectedCandidatePairId);});if(!pair)stats.forEach(r=>{if(r.type==='candidate-pair'&&r.state==='succeeded'&&r.nominated)pair=r;});if(pair){const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);$('route').textContent=[local?.candidateType,remote?.candidateType].includes('relay')?'Encrypted relay':'Direct · encrypted';$('viewer-stats').textContent=pair.currentRoundTripTime?Math.round(pair.currentRoundTripTime*1000)+' ms':'';}}catch{}},1500);
}
function closeLocal(){
  const s=current;current=null;clearInterval(statsTimer);if(s){clearTimeout(s.timeout);clearTimeout(s.disconnectTimer);s.pc&&(s.pc.onconnectionstatechange=null);s.channel?.close();s.pc?.close();for(const track of s.stream?.getTracks()||[])track.stop();window.si.release(s.id).catch(()=>{});}
  $('remote-video').srcObject=null;$('viewer').hidden=true;$('sharing-banner').hidden=true;$('route').textContent='Finding the best route';$('viewer-stats').textContent='';
}
$('disconnect').onclick=$('stop-sharing').onclick=attempt(async()=>{await window.si.end(current?.id);closeLocal();});
$('fullscreen').onclick=attempt(async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await $('viewer').requestFullscreen();});
function control(event){if(current?.role==='viewer'&&current.channel?.readyState==='open')current.channel.send(JSON.stringify(event));}
function point(e){const v=$('remote-video'),rect=v.getBoundingClientRect();if(!v.videoWidth||!v.videoHeight)return null;const scale=Math.min(rect.width/v.videoWidth,rect.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale,left=rect.left+(rect.width-w)/2,top=rect.top+(rect.height-h)/2;if(e.clientX<left||e.clientX>left+w||e.clientY<top||e.clientY>top+h)return null;return {x:(e.clientX-left)/w,y:(e.clientY-top)/h};}
let lastMove=0;const area=$('video-area');area.onpointermove=e=>{if(performance.now()-lastMove<16)return;lastMove=performance.now();const p=point(e);if(p)control({kind:'move',...p});};area.onpointerdown=e=>{const p=point(e);if(!p)return;e.preventDefault();area.focus();area.setPointerCapture(e.pointerId);control({kind:'move',...p});control({kind:'button',button:e.button,down:true});};area.onpointerup=e=>{e.preventDefault();control({kind:'button',button:e.button,down:false});};area.oncontextmenu=e=>e.preventDefault();area.addEventListener('wheel',e=>{e.preventDefault();control({kind:'scroll',dy:e.deltaY});},{passive:false});area.onkeydown=e=>{if(e.code==='Escape'&&document.fullscreenElement)return;e.preventDefault();control({kind:'key',code:e.code,down:true});};area.onkeyup=e=>{e.preventDefault();control({kind:'key',code:e.code,down:false});};area.onblur=()=>control({kind:'release'});window.addEventListener('blur',()=>control({kind:'release'}));
let signalQueue=Promise.resolve();
window.si.onEvent(b=>{
  if(b.type==='state')render(b);
  else if(b.type==='devices')renderDevices(b.devices);
  else if(b.type==='error'){toast(b.message);if(!current)$('viewer').hidden=true;}
  else if(b.type==='incoming'){pendingIncoming=b.session;$('incoming-name').textContent=b.viewerName+' is signed in to your SI account.';$('incoming-dialog').showModal();}
  else if(b.type==='start-host')startHost(b).catch(e=>toast(e.message));
  else if(b.type==='accepted')startViewer(b).catch(e=>toast(e.message));
  else if(b.type==='signal')signalQueue=signalQueue.then(()=>signal(b)).catch(e=>toast('Connection error: '+e.message));
  else if(b.type==='ended'){if(pendingIncoming===b.session){pendingIncoming=null;$('incoming-dialog').close();}closeLocal();toast(b.reason);}
  else if(b.type==='stop-host'||b.type==='stop-viewer')closeLocal();
});
window.si.state().then(render).catch(e=>toast(e.message));
