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
 function createPointerSender({sendMotion,sendReliable,modern,schedule,cancel,idleSchedule,idleCancel}){
  let pending=null,last=null,seq=0,timer=null,idle=null,disposed=false;
  function cancelIdle(){if(idle!==null)idleCancel?.(idle);idle=null;}
  function flush(){timer=null;if(disposed||!pending)return;const event=pending;if(sendMotion(event)){if(pending===event)pending=null;}if(pending)queue();}
  function queue(){if(timer===null&&!disposed)timer=schedule(flush);}
  return {
   move(p){if(disposed||!position(p))return;last={x:p.x,y:p.y};pending={kind:'move',...last,seq:++seq};queue();cancelIdle();if(idleSchedule&&modern())idle=idleSchedule(()=>{idle=null;if(disposed||!last)return;pending=null;sendReliable({kind:'move',...last,seq});});},
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
 function lowDelayReceiver(receiver){try{if(receiver&&'jitterBufferTarget' in receiver)receiver.jitterBufferTarget=0;}catch{}}
 async function tuneSender(sender,{relay=false}={}){
  if(sender.track?.kind!=='video')return;
  try{sender.track.contentHint='motion';}catch{}
  const params=sender.getParameters();if(!params.encodings?.length)return;
  params.degradationPreference='maintain-framerate';for(const e of params.encodings){e.maxBitrate=relay?2000000:6000000;e.maxFramerate=relay?30:60;e.scaleResolutionDownBy=relay?1.5:1;}
  try{await sender.setParameters(params);}catch{delete params.degradationPreference;try{await sender.setParameters(params);}catch{}}
 }
 return {createPointerReceiver,createPointerSender,lowDelayReceiver,tuneSender};
});
