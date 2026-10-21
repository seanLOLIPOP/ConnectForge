'use strict';
const sessionAPI=window.SISessionAPI||window.si,embedded=!!window.SISessionAPI;
const $=id=>document.getElementById(id);let state=null,current=null,pendingIncoming=null,toastTimer,statsTimer;
const filesUI=SIFileUI.create({api:sessionAPI,session:()=>current,toast,endpoints:side=>!embedded?SIWorkspace.fileEndpoint(side):null});
const platform=p=>({win32:'Windows',darwin:'macOS',linux:'Linux'}[p]||p);
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
const attempt=fn=>async(...args)=>{try{return await fn(...args);}catch(e){toast(e.message);}};
function page(name){$('computers-page').hidden=name!=='computers';$('settings-page').hidden=name!=='settings';$('nav-computers').classList.toggle('active',name==='computers');$('nav-settings').classList.toggle('active',name==='settings');$('page-label').textContent=name==='computers'?'MY COMPUTERS':'THIS COMPUTER';}
function render(s){
  state=s;$('login-view').hidden=!!s.user;$('dashboard').hidden=!s.user;$('login-server').textContent='Account server · '+s.server;$('remember').disabled=!s.rememberAvailable;if(!s.rememberAvailable){$('remember').checked=false;$('remember').parentElement.title='A secure OS credential store is unavailable. Sign-in will last for this run only.';}
  if(!embedded)SIWorkspace.state(s);if(!s.user)return;
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
    const name=document.createElement('h3');name.textContent=d.name;const info=document.createElement('p');info.textContent=platform(d.platform)+' · '+(d.unattended?'Ready for unattended access':'Approval required');const actions=document.createElement('div');actions.className='device-actions';const connect=document.createElement('button');connect.className='secondary';connect.textContent=d.online?'Connect →':'Offline';connect.disabled=!d.online;connect.onclick=attempt(async()=>{if(current||SIWorkspace.hasViews())throw Error('Disconnect the current sessions first');$('viewer-name').textContent=d.name;$('viewer').hidden=false;$('viewer-message').hidden=false;$('viewer-message').textContent='Waiting for the computer…';await sessionAPI.connect(d.id);});
    const remove=document.createElement('button');remove.className='quiet';remove.textContent='Remove';remove.onclick=attempt(async()=>{if(confirm('Remove '+d.name+' from your account? It will need to be registered again.'))await sessionAPI.remove(d.id);});actions.append(connect,remove);card.append(top,name,info,actions);$('device-grid').append(card);
  }
}
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-error').textContent='';$('login-button').disabled=true;try{render(await sessionAPI.login({email:$('email').value,password:$('password').value,remember:$('remember').checked}));$('password').value='';}catch(e){$('login-error').textContent=e.message;}finally{$('login-button').disabled=false;}};
$('logout').onclick=attempt(async()=>{closeLocal();render(await sessionAPI.logout());});
$('nav-computers').onclick=()=>page('computers');$('nav-settings').onclick=$('setup-button').onclick=()=>page('settings');
$('settings-form').onsubmit=attempt(async e=>{e.preventDefault();render(await sessionAPI.settings({name:$('computer-name').value,unattended:$('unattended').checked}));$('save-result').textContent='Saved';setTimeout(()=>$('save-result').textContent='',3000);});
$('fix').onclick=attempt(async()=>{$('diagnostics-results').textContent='Checking your connection…';$('diagnostics-dialog').showModal();const checks=await sessionAPI.diagnostics();$('diagnostics-results').replaceChildren();for(const c of checks){const row=document.createElement('div');row.className='check-result';const title=document.createElement('strong');title.textContent=(c.ok?'✓ ':'! ')+c.name;const detail=document.createElement('p');detail.textContent=c.detail;row.append(title,detail);$('diagnostics-results').append(row);}});
$('close-diagnostics').onclick=()=>$('diagnostics-dialog').close();
$('allow').onclick=attempt(async()=>{const id=pendingIncoming;pendingIncoming=null;$('incoming-dialog').close();await sessionAPI.approve(id);});
$('deny').onclick=attempt(async()=>{if(pendingIncoming)await sessionAPI.end(pendingIncoming);$('incoming-dialog').close();pendingIncoming=null;});
$('incoming-dialog').addEventListener('cancel',e=>{e.preventDefault();$('deny').click();});
// All screen/input traffic uses WebRTC's encrypted media and data channels.
function preferHardwareCodec(transceiver){
  // Keep every supported codec so peers without H.264 can still negotiate.
  if(!transceiver?.setCodecPreferences)return;
  try{const codecs=RTCRtpReceiver.getCapabilities('video')?.codecs||[];if(codecs.some(c=>c.mimeType.toLowerCase()==='video/h264'))transceiver.setCodecPreferences([...codecs.filter(c=>c.mimeType.toLowerCase()==='video/h264'),...codecs.filter(c=>c.mimeType.toLowerCase()!=='video/h264')]);}catch{}
}
function addScreenTrack(pc,track,stream){
  const sender=pc.addTrack(track,stream);preferHardwareCodec(pc.getTransceivers().find(t=>t.sender===sender));
}
function peer(s,relay=false){
  s.filesRPC?.close();s.filesRPC=null;s.fileChannel?.close();s.fileChannel=null;s.peerFilesVersion=0;filesUI.reset();sessionAPI.filesEnd(s.id).catch(()=>{});
  if(s.role==='host')sessionAPI.release(s.id).catch(()=>{});
  s.pointerSender?.dispose();s.pointerSender=null;s.inputForwarder?.dispose();s.inputForwarder=null;s.motionChannel?.close();s.motionChannel=null;s.peerInputVersion=0;s.bufferSample=null;s.controlRTT=null;s.tunedRelay=null;s.videoController=null;s.pressureSample=null;
  if(s.clipboardEnabled)sessionAPI.clipboardEnable({session:s.id,enabled:false}).catch(()=>{});
  s.clipboardEnabled=false;s.peerClipboardEnabled=false;s.clipboardChannel=null;s.peerClipboard=false;
  const pc=new RTCPeerConnection({iceServers:s.iceServers,iceTransportPolicy:relay?'relay':'all'});s.pc=pc;s.candidates=[];s.remoteReady=false;s.relay=relay;
  pc.onicecandidate=e=>{if(e.candidate)sessionAPI.signal({session:s.id,payload:{kind:'candidate',candidate:e.candidate.toJSON()}}).catch(e=>toast(e.message));};
  pc.ontrack=e=>{SILatency.lowDelayReceiver(e.receiver);$('remote-video').srcObject=e.streams[0]||new MediaStream([e.track]);$('viewer-message').hidden=true;};
  pc.ondatachannel=e=>{if(e.channel.label==='input')bindChannel(s,e.channel);else if(e.channel.label==='motion-v1'&&s.peerInputVersion===2)bindMotion(s,e.channel);else if(e.channel.label==='files-v1'&&s.peerFilesVersion===1)bindFiles(s,e.channel);else if(e.channel.label==='clipboard-v1'&&s.peerClipboard)bindClipboard(s,e.channel);else e.channel.close();};
  pc.onconnectionstatechange=()=>{
    if(current!==s||s.pc!==pc)return;
    if(pc.connectionState==='connected'){clearTimeout(s.timeout);$('viewer-message').hidden=true;updateStats(s);}
    if(pc.connectionState==='failed')retryRelay(s);
    if(pc.connectionState==='disconnected'){clearTimeout(s.disconnectTimer);s.disconnectTimer=setTimeout(()=>{if(pc.connectionState==='disconnected')retryRelay(s);},8000);}
  };
  if(s.stream)for(const track of s.stream.getTracks())addScreenTrack(pc,track,s.stream);
  clearTimeout(s.timeout);s.timeout=setTimeout(()=>{if(pc.connectionState!=='connected')retryRelay(s);},20000);
  return pc;
}
function forwardInput(s,event){
  if(!s.inputForwarder)s.inputForwarder=SILatency.createInputForwarder({active:()=>current===s,send:event=>event.kind==='release'?sessionAPI.release(s.id):sessionAPI.input({session:s.id,event})});
  if(s.peerInputVersion===2)s.inputForwarder.forward(event);
  else if(event.kind==='release')sessionAPI.release(s.id).catch(()=>{});else sessionAPI.input({session:s.id,event}).catch(()=>{});
}
async function applyQuality(s){
  if(current!==s||s.role!=='host')return;
  const base=s.videoProfile||{maxBitrate:s.relay?2000000:6000000,maxFramerate:s.relay?30:60,scaleResolutionDownBy:s.relay?1.5:1};
  for(const sender of s.pc.getSenders())await SILatency.tuneSender(sender,{relay:s.relay,profile:SILatency.qualityProfile(base,s.quality,sender.track)});
}
function sendQuality(s){
  const ready=s?.role==='viewer'&&s.peerQuality&&s.channel?.readyState==='open';
  for(const id of ['resolution','bitrate'])$(id).disabled=!ready;
  if(ready)s.channel.send(JSON.stringify({kind:'quality',height:Number($('resolution').value),bitrate:Number($('bitrate').value)}));
}
for(const id of ['resolution','bitrate'])$(id).onchange=()=>sendQuality(current);
function bindChannel(s,channel){
  s.pointerSender?.dispose();
  s.channel=channel;channel.onopen=()=>{if(s.role==='viewer'){if(!embedded)$('video-area').focus();$('viewer-message').hidden=true;sendQuality(s);}};
  let count=0,windowStart=performance.now();channel.onmessage=e=>{
    if(current!==s||s.channel!==channel||typeof e.data!=='string'||e.data.length>1024)return;
    if(performance.now()-windowStart>1000){count=0;windowStart=performance.now();}if(++count>300)return;
    try{const event=JSON.parse(e.data);
      if(event.kind==='ping'&&s.role==='host'&&s.peerInputVersion===2&&Number.isFinite(event.id)){sessionAPI.input({session:s.id,event:{kind:'probe'}}).then(()=>{if(current===s&&s.channel===channel&&channel.readyState==='open')channel.send(JSON.stringify({kind:'pong',id:event.id}));}).catch(()=>{});return;}
      if(event.kind==='pong'&&s.role==='viewer'){if(event.id===s.pingAt)s.controlRTT=performance.now()-event.id;return;}
      if(s.role!=='host')return;
      if(event.kind==='quality'){if([0,720,1080,1440,2160].includes(event.height)&&[0,500000,1000000,2000000,4000000,8000000,16000000].includes(event.bitrate)){s.quality={height:event.height,bitrate:event.bitrate};s.qualityRevision=(s.qualityRevision||0)+1;const revision=s.qualityRevision;s.qualityWork=(s.qualityWork||Promise.resolve()).catch(()=>{}).then(()=>revision===s.qualityRevision?applyQuality(s):undefined).catch(()=>{});}return;}
      forwardInput(s,event);
    }catch{}
  };
  channel.onclose=()=>{if(s.role==='host'&&current===s&&s.channel===channel){s.inputForwarder?.dispose();s.inputForwarder=null;sessionAPI.release(s.id).catch(()=>{});}};
  if(s.role==='viewer')s.pointerSender=SILatency.createPointerSender({
    modern:()=>s.peerInputVersion===2,
    sendReliable:event=>{if(current!==s||channel.readyState!=='open')return false;channel.send(JSON.stringify(event));return true;},
    sendMotion:event=>{if(current!==s)return true;const c=s.motionChannel?.readyState==='open'?s.motionChannel:channel;if(c.readyState!=='open'||c.bufferedAmount>(c===channel?1024:256))return false;c.send(JSON.stringify(event));return true;},
    immediate:true,now:()=>performance.now(),schedule:fn=>setTimeout(fn,8),cancel:id=>clearTimeout(id),idleSchedule:fn=>setTimeout(fn,80),idleCancel:id=>clearTimeout(id)
  });
}
function bindMotion(s,channel){
  if(s.motionChannel){channel.close();return;}s.motionChannel=channel;let count=0,start=performance.now();
  channel.onmessage=e=>{if(current!==s||s.motionChannel!==channel||s.role!=='host'||s.channel?.readyState!=='open'||typeof e.data!=='string'||e.data.length>256)return;if(performance.now()-start>1000){count=0;start=performance.now();}if(++count>240)return;try{const event=JSON.parse(e.data);if(event.kind==='move'&&Number.isSafeInteger(event.seq)&&event.seq>=0)forwardInput(s,event);}catch{}};
}
let clipboardState={entries:[],persistent:false,enabled:false};
function clipboardStatus(){
  const s=current,ready=s?.clipboardChannel?.readyState==='open';
  for(const id of ['clipboard-viewer','clipboard-host'])$(id).textContent=s?.clipboardEnabled?(s.peerClipboardEnabled?'Clipboard · on':'Clipboard · waiting'):'Clipboard';
  $('clipboard-enabled').disabled=!ready;$('clipboard-enabled').checked=!!s?.clipboardEnabled;
  $('clipboard-status').textContent=[!s?'No active session':!ready?'Update both apps to use shared clipboard':s.clipboardEnabled&&s.peerClipboardEnabled?'Sharing text in both directions':s.clipboardEnabled?'Waiting for clipboard sharing to be enabled on the other computer':'Clipboard sharing is off',clipboardState.persistent?'History saved encrypted on this computer':'History kept in memory: secure OS storage is unavailable'].join(' · ');
}
function renderClipboard(b){
  clipboardState=b;if(current)current.clipboardEnabled=b.enabled&&b.session===current.id;
  $('clipboard-items').replaceChildren();
  for(const item of b.entries||[]){const row=document.createElement('div');row.className='clipboard-item';const preview=document.createElement('pre');preview.textContent=item.text.slice(0,180);const copy=document.createElement('button');copy.className='secondary';copy.textContent='Copy';copy.onclick=attempt(async()=>{await sessionAPI.clipboardCopy(item.id);toast('Copied'+(current?.clipboardEnabled&&current.peerClipboardEnabled?' and shared':''));});row.append(preview,copy);$('clipboard-items').append(row);}
  if(!b.entries?.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No saved text copies yet.';$('clipboard-items').append(empty);}
  clipboardStatus();if(b.error)toast(b.error);
}
async function openClipboard(){renderClipboard(await sessionAPI.clipboardList());$('clipboard-dialog').showModal();}
for(const id of ['clipboard-viewer','clipboard-host','clipboard-saved'])$(id).onclick=attempt(openClipboard);
$('clipboard-close').onclick=()=>$('clipboard-dialog').close();
$('clipboard-clear').onclick=attempt(async()=>{await sessionAPI.clipboardClear();renderClipboard(await sessionAPI.clipboardList());});
$('clipboard-enabled').onchange=attempt(async()=>{const s=current;if(!s)return;const b=await sessionAPI.clipboardEnable({session:s.id,enabled:$('clipboard-enabled').checked});if(current!==s)return;renderClipboard(b);if(s.clipboardChannel?.readyState==='open')s.clipboardChannel.send(s.clipboardEnabled?'S1':'S0');});
function bindFiles(s,channel){
 if(s.fileChannel){channel.close();return;}s.fileChannel=channel;
 s.filesRPC=SIFileRPC.create({channel,handle:request=>sessionAPI.files({session:s.id,request}),onClose:()=>{if(current===s&&s.fileChannel===channel){s.fileChannel=null;filesUI.reset();sessionAPI.filesEnd(s.id).catch(()=>{});}}});
 channel.onopen=()=>{if(current===s){filesUI.available();if(embedded)sessionAPI.ready(s.filesRPC);}};filesUI.available();if(embedded&&channel.readyState==='open')sessionAPI.ready(s.filesRPC);
}
function bindClipboard(s,channel){
  if(s.clipboardChannel){channel.close();return;}s.clipboardChannel=channel;
  channel.onopen=()=>{if(current!==s)return;channel.send(s.clipboardEnabled?'S1':'S0');clipboardStatus();};
  let received=0;
  channel.onmessage=e=>{
    if(current!==s||s.clipboardChannel!==channel||typeof e.data!=='string'||e.data.length>16385)return;
    if(e.data==='S1'||e.data==='S0'){s.peerClipboardEnabled=e.data==='S1';clipboardStatus();return;}
    if(e.data[0]!=='T'||!s.clipboardEnabled||!s.peerClipboardEnabled||Date.now()-received<250)return;
    received=Date.now();sessionAPI.clipboardReceive({session:s.id,text:e.data.slice(1)}).catch(e=>toast(e.message));
  };
  channel.onclose=()=>{if(current!==s||s.clipboardChannel!==channel)return;s.clipboardEnabled=false;s.peerClipboardEnabled=false;sessionAPI.clipboardEnable({session:s.id,enabled:false}).catch(()=>{});clipboardStatus();};
}
async function startHost(b){
  closeLocal();const s=current={id:b.session,role:'host',iceServers:b.iceServers,stream:null,channel:null};peer(s);$('sharing-banner').hidden=false;
  s.ready=(async()=>{
    const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:60,max:60},width:{max:3840},height:{max:2160}},audio:false});
    if(current!==s){stream.getTracks().forEach(t=>t.stop());return;}
    s.stream=stream;for(const t of stream.getTracks()){try{t.contentHint='motion';}catch{}addScreenTrack(s.pc,t,stream);t.onended=()=>sessionAPI.end(s.id);}
  })();
  try{await s.ready;}catch(e){toast('Could not share this screen: '+e.message);await sessionAPI.end(s.id);closeLocal();}
}
async function startViewer(b){if(embedded){$('resolution').value='720';$('bitrate').value='2000000';}
  const s=current={id:b.session,role:'viewer',iceServers:b.iceServers,relayAvailable:b.relayAvailable,stream:null,channel:null};$('viewer').hidden=false;await offer(s,false);
}
async function offer(s,relay){
  if(s.pc){s.pc.onconnectionstatechange=null;s.pc.close();}const pc=peer(s,relay);bindChannel(s,pc.createDataChannel('input',{ordered:true}));preferHardwareCodec(pc.addTransceiver('video',{direction:'recvonly'}));
  await pc.setLocalDescription(await pc.createOffer());await sessionAPI.signal({session:s.id,payload:{kind:'offer',description:pc.localDescription.toJSON(),clipboardVersion:1,inputVersion:2,qualityVersion:1,filesVersion:1}});
}
async function signal(b){
  const s=current;if(!s||s.id!==b.session)return;const p=b.payload;
  if(p.kind==='restart'&&s.role==='host'){await s.ready;if(s.pc){s.pc.onconnectionstatechange=null;s.pc.close();}peer(s,p.relay===true);return;}
  if(p.kind==='candidate'){if(s.remoteReady)await s.pc.addIceCandidate(p.candidate);else s.candidates.push(p.candidate);return;}
  if(p.kind==='offer'&&s.role==='host'){
    s.peerFilesVersion=p.filesVersion===1?1:0;s.peerClipboard=p.clipboardVersion===1;s.peerInputVersion=p.inputVersion===2?2:0;
    await s.ready;if(current!==s)return;const pc=s.pc;await pc.setRemoteDescription(p.description);for(const t of pc.getTransceivers())preferHardwareCodec(t);s.remoteReady=true;for(const c of s.candidates)await pc.addIceCandidate(c);s.candidates=[];await pc.setLocalDescription(await pc.createAnswer());
    for(const sender of pc.getSenders())await SILatency.tuneSender(sender,{relay:s.relay});
    await sessionAPI.signal({session:s.id,payload:{kind:'answer',description:pc.localDescription.toJSON(),clipboardVersion:1,inputVersion:2,qualityVersion:1,filesVersion:1}});return;
  }
  if(p.kind==='answer'&&s.role==='viewer'){s.peerFilesVersion=p.filesVersion===1?1:0;if(s.peerFilesVersion===1)bindFiles(s,s.pc.createDataChannel('files-v1',{ordered:true}));s.peerQuality=p.qualityVersion===1;sendQuality(s);await s.pc.setRemoteDescription(p.description);s.remoteReady=true;for(const c of s.candidates)await s.pc.addIceCandidate(c);s.candidates=[];s.peerInputVersion=p.inputVersion===2?2:0;if(s.peerInputVersion===2)bindMotion(s,s.pc.createDataChannel('motion-v1',{ordered:false,maxRetransmits:0}));s.peerClipboard=p.clipboardVersion===1;if(s.peerClipboard)bindClipboard(s,s.pc.createDataChannel('clipboard-v1',{ordered:true}));}
}
async function retryRelay(s){
  if(current!==s||s.retrying||s.role!=='viewer')return;s.retrying=true;
  try{if(!s.relay&&s.relayAvailable){$('route').textContent='Trying encrypted relay…';await sessionAPI.signal({session:s.id,payload:{kind:'restart',relay:true}});await offer(s,true);}
  else{toast('Could not reach this computer. Check its network and try Auto-fix connection.');await sessionAPI.end(s.id);closeLocal();}}finally{s.retrying=false;}
}
function videoStats(stats,role){
  const video=[...stats.values()].find(r=>r.type===(role==='host'?'outbound-rtp':'inbound-rtp')&&r.kind==='video'&&(role==='host'?r.framesEncoded:r.framesDecoded)>0);
  if(!video)return '';
  const codec=stats.get(video.codecId)?.mimeType?.replace('video/','')||'Video',hardware=role==='host'?video.powerEfficientEncoder:video.powerEfficientDecoder,action=role==='host'?'encode':'decode';
  return [codec,Number.isFinite(video.framesPerSecond)?Math.round(video.framesPerSecond)+' FPS':'',hardware===true?'GPU '+action:hardware===false?'CPU '+action:action+' unknown'].filter(Boolean).join(' · ');
}
function updateStats(s){
  clearInterval(statsTimer);const pc=s.pc;let busy=false;
  const refresh=async()=>{
    if(current!==s||s.pc!==pc||busy)return;busy=true;
    try{
      const stats=await pc.getStats();if(current!==s||s.pc!==pc)return;
      const media=videoStats(stats,s.role);
      let pair;stats.forEach(r=>{if(r.type==='transport'&&r.selectedCandidatePairId)pair=stats.get(r.selectedCandidatePairId);});
      if(!pair)stats.forEach(r=>{if(r.type==='candidate-pair'&&r.state==='succeeded'&&r.nominated)pair=r;});
      if(s.role==='host'){
        $('sharing-stats').textContent=media;
        if(pair){const relay=[stats.get(pair.localCandidateId)?.candidateType,stats.get(pair.remoteCandidateId)?.candidateType].includes('relay');if(s.tunedRelay!==relay){s.tunedRelay=relay;s.videoController=SILatency.createVideoController({relay});s.pressureSample=null;}
          const video=[...stats.values()].find(r=>r.type==='outbound-rtp'&&r.kind==='video'&&r.framesEncoded>0),pressure=SILatency.videoPressure(video,s.pressureSample);s.pressureSample=video;
          const profile=s.videoController.sample({...pressure,availableBitrate:pair.availableOutgoingBitrate});
          if(profile){s.videoProfile=profile;s.qualityWork=(s.qualityWork||Promise.resolve()).catch(()=>{}).then(()=>applyQuality(s));await s.qualityWork;}
        }
        return;
      }
      if(pair){const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);$('route').textContent=[local?.candidateType,remote?.candidateType].includes('relay')?'Encrypted relay':'Direct · encrypted';}
      if(s.peerInputVersion===2&&s.channel?.readyState==='open'){s.pingAt=performance.now();s.channel.send(JSON.stringify({kind:'ping',id:s.pingAt}));}
      const inbound=[...stats.values()].find(r=>r.type==='inbound-rtp'&&r.kind==='video'&&r.framesDecoded>0),previous=s.bufferSample;
      let bufferMs;if(inbound){const frames=inbound.jitterBufferEmittedCount-(previous?.frames||0),delay=inbound.jitterBufferDelay-(previous?.delay||0);if(frames>0)bufferMs=delay*1000/frames;s.bufferSample={frames:inbound.jitterBufferEmittedCount,delay:inbound.jitterBufferDelay};}
      const display=$('remote-video');$('viewer-stats').textContent=[Number.isFinite(pair?.currentRoundTripTime)?Math.round(pair.currentRoundTripTime*1000)+' ms RTT':'',media,display.videoWidth?display.videoWidth+'×'+display.videoHeight:'',Number.isFinite(bufferMs)?Math.round(bufferMs)+' ms buffer':'',Number.isFinite(s.controlRTT)?Math.round(s.controlRTT)+' ms control':''].filter(Boolean).join(' · ');
    }catch{}finally{busy=false;}
  };refresh();statsTimer=setInterval(refresh,1500);
}
function closeLocal(){if(embedded)sessionAPI.ready(null);
  current?.filesRPC?.close();current?.fileChannel?.close();filesUI.reset();if(current)sessionAPI.filesEnd(current.id).catch(()=>{});
  if(nativeFullscreen)sessionAPI.fullscreen(false).then(setFullscreenState).catch(()=>{});
  for(const id of ['resolution','bitrate']){$(id).value='0';$(id).disabled=true;}
  const s=current;current=null;clearInterval(statsTimer);if(s){s.pointerSender?.dispose();s.inputForwarder?.dispose();clearTimeout(s.timeout);clearTimeout(s.disconnectTimer);s.pc&&(s.pc.onconnectionstatechange=null);s.motionChannel?.close();s.channel?.close();s.clipboardChannel?.close();s.pc?.close();for(const track of s.stream?.getTracks()||[])track.stop();sessionAPI.clipboardEnable({session:s.id,enabled:false}).catch(()=>{});sessionAPI.release(s.id).catch(()=>{});}clipboardStatus();
  $('remote-video').srcObject=null;$('viewer').hidden=true;$('sharing-banner').hidden=true;$('route').textContent='Finding the best route';$('viewer-stats').textContent='';$('sharing-stats').textContent='';
}
$('disconnect').onclick=$('stop-sharing').onclick=attempt(async()=>{await sessionAPI.end(current?.id);closeLocal();});
let nativeFullscreen=false;
function setFullscreenState(enabled){nativeFullscreen=enabled;$('fullscreen').textContent=enabled?'Exit fullscreen':'Fullscreen';}
$('fullscreen').onclick=attempt(async()=>{setFullscreenState(await sessionAPI.fullscreen(!nativeFullscreen));$('video-area').focus();});
document.addEventListener('keydown',e=>{if(e.code==='Escape'&&nativeFullscreen){e.preventDefault();e.stopImmediatePropagation();sessionAPI.fullscreen(false).then(setFullscreenState).catch(e=>toast(e.message));}},true);

function control(event){const s=current;if(s?.role!=='viewer'||s.channel?.readyState!=='open')return;if(event.kind==='move')s.pointerSender?.move(event);else s.pointerSender?.control(event);}
function point(e){const v=$('remote-video'),rect=v.getBoundingClientRect();if(!v.videoWidth||!v.videoHeight)return null;const scale=Math.min(rect.width/v.videoWidth,rect.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale,left=rect.left+(rect.width-w)/2,top=rect.top+(rect.height-h)/2;if(e.clientX<left||e.clientX>left+w||e.clientY<top||e.clientY>top+h)return null;return {x:(e.clientX-left)/w,y:(e.clientY-top)/h};}
let hoverEpoch=0;const area=$('video-area');if(embedded){area.onpointerenter=()=>{sessionAPI.focus();area.focus();};area.onpointerleave=()=>{control({kind:'release'});hoverEpoch++;sessionAPI.blur();area.blur();};}area.onpointermove=e=>{const p=point(e);if(p)control({kind:'move',...p});};area.onpointerdown=e=>{const p=point(e);if(!p)return;e.preventDefault();area.focus();if(!embedded)area.setPointerCapture(e.pointerId);current?.pointerSender?.control({kind:'button',button:e.button,down:true},p);};area.onpointerup=e=>{e.preventDefault();current?.pointerSender?.control({kind:'button',button:e.button,down:false},point(e));};area.oncontextmenu=e=>e.preventDefault();area.addEventListener('wheel',e=>{e.preventDefault();const dy=SILatency.wheelPixels(e.deltaY,e.deltaMode,area.clientHeight);if(dy)current?.pointerSender?.control({kind:'scroll',dy},point(e));},{passive:false});area.onkeydown=e=>{if(embedded&&['MetaLeft','MetaRight','ControlLeft','ControlRight'].includes(e.code)){e.preventDefault();return;}if(embedded&&(e.metaKey||e.ctrlKey)&&['KeyC','KeyX','KeyV'].includes(e.code)){e.preventDefault();const generation=hoverEpoch,code=sessionAPI.targetPlatform==='darwin'?'MetaLeft':'ControlLeft';const send=()=>{if(generation!==hoverEpoch)return;control({kind:'release'});control({kind:'key',code,down:true});control({kind:'key',code:e.code,down:true});control({kind:'key',code:e.code,down:false});control({kind:'key',code,down:false});};if(e.code==='KeyV')sessionAPI.syncClipboard().then(send).catch(e=>toast(e.message));else{send();setTimeout(()=>sessionAPI.syncClipboard(),150);}return;}if(embedded){if(e.ctrlKey)control({kind:'key',code:'ControlLeft',down:true});if(e.metaKey)control({kind:'key',code:'MetaLeft',down:true});}if(e.code==='Escape'&&document.fullscreenElement)return;e.preventDefault();control({kind:'key',code:e.code,down:true});};area.onkeyup=e=>{e.preventDefault();control({kind:'key',code:e.code,down:false});};area.onblur=()=>{hoverEpoch++;control({kind:'release'});};window.addEventListener('blur',()=>control({kind:'release'}));
let signalQueue=Promise.resolve();
sessionAPI.onEvent(b=>{
  if(!embedded&&SIWorkspace.route(b))return;
  if(b.type==='workspace-clipboard'){const el=$('workspace-host-clipboard');el.hidden=!b.enabled;return;}
  if(b.type==='workspace-blur'){control({kind:'release'});hoverEpoch++;area.blur();return;}
  if(b.type==='fullscreen'){setFullscreenState(b.enabled);}
  else if(b.type==='update-progress'){
    $('update-progress').hidden=b.stage==='idle';$('update-progress-bar').value=b.percent||0;
    $('update-progress-title').textContent=b.stage==='retrying'?'Connection interrupted — resuming download':b.stage==='verifying'?'Verifying update':b.stage==='complete'?'Download verified':'Downloading update';
    $('update-progress-detail').textContent=b.stage==='downloading'?b.percent+'% · '+(b.received/1048576).toFixed(1)+' / '+(b.total/1048576).toFixed(1)+' MB · '+(b.bytesPerSecond/1048576).toFixed(2)+' MB/s'+(b.secondsRemaining!==null?' · about '+Math.ceil(b.secondsRemaining/60)+' min remaining':''):b.stage==='retrying'?'Retry '+b.attempt+' of 3. Downloaded data is retained.':'';
  }
  else if(b.type==='clipboard-history')renderClipboard(b);
  else if(b.type==='clipboard-local'){const s=current,c=s?.clipboardChannel;if(s&&s.id===b.session&&s.clipboardEnabled&&s.peerClipboardEnabled&&c?.readyState==='open'&&c.bufferedAmount<32768)c.send('T'+b.text);}
  else if(b.type==='state')render(b);
  else if(b.type==='devices')renderDevices(b.devices);
  else if(b.type==='error'){toast(b.message);if(!current)$('viewer').hidden=true;}
  else if(b.type==='incoming'){pendingIncoming=b.session;$('incoming-name').textContent=b.viewerName+' is signed in to your SI account.';$('incoming-dialog').showModal();}
  else if(b.type==='start-host')startHost(b).catch(e=>toast(e.message));
  else if(b.type==='accepted')startViewer(b).catch(e=>toast(e.message));
  else if(b.type==='signal')signalQueue=signalQueue.then(()=>signal(b)).catch(e=>toast('Connection error: '+e.message));
  else if(b.type==='ended'){if(pendingIncoming===b.session){pendingIncoming=null;$('incoming-dialog').close();}if(current?.id===b.session)closeLocal();toast(b.reason);}
  else if(b.type==='stop-host'||b.type==='stop-viewer')closeLocal();
});
sessionAPI.state().then(render).catch(e=>toast(e.message));

$('updates').onclick=attempt(()=>sessionAPI.updates());

window.SIHasSession=()=>!!current;
if(!embedded)SIWorkspace.init({api:sessionAPI,getState:()=>state,toast,filesUI});
else{
 $('fullscreen').hidden=true;$('clipboard-viewer').onclick=()=>sessionAPI.history();$('files-viewer').onclick=()=>sessionAPI.filesPage();
 $('viewer-name').textContent='Connecting…';$('viewer').hidden=false;
}
