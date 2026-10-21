'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SIFileRPC=api;})(globalThis,()=>{
 function create({channel,handle,onClose=()=>{},timeout=120000}){
  let closed=false,queue=Promise.resolve(),working=0;const pending=new Map(),parts=new Map();
  function close(){if(closed)return;closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('File channel disconnected'));}pending.clear();for(const p of parts.values())clearTimeout(p.timer);parts.clear();onClose();}
  function send(value){const json=JSON.stringify(value);if(json.length>4000000)return Promise.reject(Error('File response is too large'));const id=crypto.randomUUID(),total=Math.ceil(json.length/4000);const job=queue.then(async()=>{for(let part=0;part<total;part++){while(!closed&&channel.readyState==='open'&&channel.bufferedAmount>65536)await new Promise(r=>setTimeout(r,5));if(closed||channel.readyState!=='open')throw Error('File channel disconnected');channel.send(JSON.stringify({id,part,total,data:json.slice(part*4000,(part+1)*4000)}));}});queue=job.catch(()=>{});return job;}
  async function receive(message){if(message.type==='reply'){const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.value);return;}
   if(message.type!=='request'||typeof message.id!=='string'||message.id.length>80)return;if(working>=8){await send({type:'reply',id:message.id,error:'File operations are busy'});return;}working++;
   try{const value=await handle(message.request);if(!closed)await send({type:'reply',id:message.id,value});}catch(e){if(!closed)await send({type:'reply',id:message.id,error:String(e.message||e).slice(0,500)}).catch(()=>{});}finally{working--;}
  }
  channel.onmessage=e=>{if(closed||typeof e.data!=='string'||e.data.length>30000)return;try{const f=JSON.parse(e.data);if(typeof f.id!=='string'||f.id.length>80||!Number.isInteger(f.total)||f.total<1||f.total>1000||!Number.isInteger(f.part)||f.part<0||f.part>=f.total||typeof f.data!=='string'||f.data.length>4000)return;let p=parts.get(f.id);if(!p){if(parts.size>=8||f.part!==0)return;p={items:[],total:f.total,timer:setTimeout(()=>parts.delete(f.id),timeout)};parts.set(f.id,p);}if(p.total!==f.total||p.items.length!==f.part)return;p.items.push(f.data);if(p.items.length===p.total){parts.delete(f.id);clearTimeout(p.timer);receive(JSON.parse(p.items.join(''))).catch(()=>{});}}catch{}};
  channel.onclose=close;channel.onerror=close;
  return {call(op,args={}){if(closed||channel.readyState!=='open')return Promise.reject(Error('File channel is not ready'));if(pending.size>=8)return Promise.reject(Error('Too many file requests'));const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('File request timed out'));},timeout);pending.set(id,{resolve,reject,timer});send({type:'request',id,request:{op,args}}).catch(e=>{clearTimeout(timer);pending.delete(id);reject(e);});});},close};
 }
 return {create};
});
