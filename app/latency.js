'use strict';
// Shared by the sandboxed renderer, the native input bridge, and transport tests.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SILatency=api;})(typeof globalThis==='object'?globalThis:this,()=>{
 const position=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
 const sequence=n=>Number.isSafeInteger(n)&&n>=0;
 function createPointerReceiver(apply){
  let latest=null;
  return {reset(){latest=null;},apply(event,bounds){
   if(event?.kind==='move'&&sequence(event.seq)&&position(event)){
    if(latest&&event.seq<=latest.seq)return false;
    latest={x:event.x,y:event.y,seq:event.seq};apply(event,bounds);return true;
   }
   if(['button','scroll'].includes(event?.kind)&&sequence(event.seq)&&position(event.position)){
    const previous=latest,p={...event.position,seq:event.seq};
    if(!latest||p.seq>latest.seq)latest=p;
    // A click carries its own position. Cross-channel reordering cannot move it
    // to the wrong target, and an older click cannot rewind a newer cursor.
    apply({kind:'move',x:p.x,y:p.y},bounds);apply(event,bounds);
    if(previous&&previous.seq>p.seq)apply({kind:'move',x:previous.x,y:previous.y},bounds);
    return true;
   }
   apply(event,bounds);return true;
  }};
 }
 function createPointerSender({sendMotion,sendReliable,modern,schedule,cancel,idleSchedule,idleCancel,immediate=false,now=()=>performance.now(),interval=8}){
  let pending=null,last=null,seq=0,timer=null,idle=null,disposed=false,nextAt=0;
  function cancelIdle(){if(idle!==null)idleCancel?.(idle);idle=null;}
  function flush(){timer=null;if(disposed||!pending)return;const event=pending;if(sendMotion(event)){nextAt=now()+interval;if(pending===event)pending=null;}if(pending)queue();}
  function queue(){if(timer===null&&!disposed)timer=schedule(flush);}
  return {
   move(p){if(disposed||!position(p))return;last={x:p.x,y:p.y};pending={kind:'move',...last,seq:++seq};if(immediate&&timer===null&&now()>=nextAt)flush();else queue();cancelIdle();if(idleSchedule&&modern())idle=idleSchedule(()=>{idle=null;if(disposed||!last)return;pending=null;sendReliable({kind:'move',...last,seq});});},
   control(event,p){if(disposed)return false;if(position(p))last={x:p.x,y:p.y};
    if(event.kind==='release'){pending=null;last=null;cancelIdle();}
    if(['button','scroll'].includes(event.kind)&&last){
     cancelIdle();
     if(modern()){pending=null;return sendReliable({...event,position:last,seq:++seq});}
     // Old peers understand the original ordered move + button protocol.
     sendReliable({kind:'move',...last});pending=null;
    }
    return sendReliable(event);
   },
   dispose(){disposed=true;pending=null;cancelIdle();if(timer!==null)cancel(timer);timer=null;}
  };
 }
 function createInputForwarder({send,active=()=>true}){
  let pending=null,inFlight=false,disposed=false;
  function flush(){if(disposed||!active()||inFlight||!pending)return;const event=pending;pending=null;inFlight=true;let result;try{result=send(event);}catch{}Promise.resolve(result).catch(()=>{}).finally(()=>{inFlight=false;flush();});}
  return {forward(event){if(disposed||!active())return;if(event.kind==='move'&&sequence(event.seq)){pending=event;flush();return;}if(event.kind==='release'||(sequence(event.seq)&&pending&&pending.seq<=event.seq))pending=null;try{Promise.resolve(send(event)).catch(()=>{});}catch{}},dispose(){disposed=true;pending=null;}};
 }
 const profiles=[{maxBitrate:6000000,maxFramerate:60,scaleResolutionDownBy:1},{maxBitrate:2500000,maxFramerate:30,scaleResolutionDownBy:1.5},{maxBitrate:1000000,maxFramerate:24,scaleResolutionDownBy:2},{maxBitrate:450000,maxFramerate:15,scaleResolutionDownBy:3}];
 function createVideoController({relay=false}={}){
  const minimum=relay?1:0;let level=minimum,bad=0,healthy=0,lastKey='';
  return {sample({availableBitrate,queueMs,encodeMs,bandwidthLimited=false}={}){
   const capacity=(bandwidthLimited||queueMs>45)&&Number.isFinite(availableBitrate)&&availableBitrate>0?availableBitrate:null;
   if(capacity===null&&!Number.isFinite(queueMs)&&!Number.isFinite(encodeMs)&&lastKey)return null;
   let desired=minimum;
   if(capacity!==null)desired=Math.max(desired,capacity<650000?3:capacity<1600000?2:capacity<3500000?1:0);
   if(encodeMs>28||queueMs>45)desired=Math.max(desired,Math.min(3,level+1));
   if(queueMs>120)desired=Math.max(desired,queueMs>250?3:2);
   const severe=queueMs>120||encodeMs>55||(bandwidthLimited&&capacity!==null&&capacity<650000);
   if(desired>level){healthy=0;if(severe||++bad>=2){level=severe?Math.max(desired,Math.min(3,level+1)):desired;bad=0;}}
   else if(desired<level){bad=0;if(++healthy>=8){level--;healthy=0;}}
   else{bad=0;healthy=0;}
   const profile={...profiles[level],level};if(relay)profile.maxBitrate=Math.min(profile.maxBitrate,2000000);
   if(capacity!==null)profile.maxBitrate=Math.min(profile.maxBitrate,Math.max(200000,Math.floor(capacity*.75/100000)*100000));
   const key=JSON.stringify(profile);if(key===lastKey)return null;lastKey=key;return profile;
  }};
 }
 function videoPressure(video,previous){
  const delta=(field,count)=>{if(!video||!previous||video.id!==previous.id)return undefined;const n=video[count]-previous[count],value=video[field]-previous[field];return n>0&&Number.isFinite(value)&&value>=0?value*1000/n:undefined;};
  return {queueMs:delta('totalPacketSendDelay','packetsSent'),encodeMs:delta('totalEncodeTime','framesEncoded'),bandwidthLimited:video?.qualityLimitationReason==='bandwidth'};
 }
 function lowDelayReceiver(receiver){try{if(receiver&&'jitterBufferTarget' in receiver)receiver.jitterBufferTarget=0;}catch{}}
 async function tuneSender(sender,{relay=false,profile}={}){
  if(sender.track?.kind!=='video')return;
  try{sender.track.contentHint='motion';}catch{}
  const params=sender.getParameters();if(!params.encodings?.length)return;
  const settings=profile||{maxBitrate:relay?2000000:6000000,maxFramerate:relay?30:60,scaleResolutionDownBy:relay?1.5:1};
  params.degradationPreference='maintain-framerate';for(const e of params.encodings){e.maxBitrate=settings.maxBitrate;e.maxFramerate=settings.maxFramerate;e.scaleResolutionDownBy=settings.scaleResolutionDownBy;}
  try{await sender.setParameters(params);}catch{delete params.degradationPreference;try{await sender.setParameters(params);}catch{}}
  try{if(sender.track.applyConstraints&&sender.track.getConstraints)await sender.track.applyConstraints({...sender.track.getConstraints(),frameRate:{ideal:settings.maxFramerate,max:settings.maxFramerate}});}catch{}
 }
 return {createPointerReceiver,createPointerSender,createInputForwarder,createVideoController,videoPressure,lowDelayReceiver,tuneSender};
});
