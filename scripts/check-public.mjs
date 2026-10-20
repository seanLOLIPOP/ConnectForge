import {createRequire} from 'node:module';import fs from 'node:fs';import https from 'node:https';import path from 'node:path';
const require=createRequire(import.meta.url),{createCloudflare}=require('../app/cloudflare.cjs'),WebSocket=require('ws');
const root=path.resolve(import.meta.dirname,'..'),resources=process.argv[2],bridge=createCloudflare({packaged:!!resources,resourcesPath:resources});
try{
  const port=await bridge.bridge('connectforge.mcseanilog.com'),ca=fs.readFileSync(path.join(root,'assets/server-ca.pem'));
  const health=await new Promise((resolve,reject)=>{const r=https.get(`https://127.0.0.1:${port}/health`,{ca,timeout:15000},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>res.statusCode===200?resolve(JSON.parse(text)):reject(Error('Health check failed')));});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('Cloudflare API timed out')));});
  console.log('Cloudflare API TLS verified:',health.ok);
  await new Promise((resolve,reject)=>{const ws=new WebSocket(`wss://127.0.0.1:${port}/signal`,{ca,handshakeTimeout:10000}),timer=setTimeout(()=>{ws.terminate();reject(Error('Signaling timed out'));},15000);ws.on('open',()=>ws.send(JSON.stringify({type:'auth',token:'00'.repeat(32)})));ws.on('message',data=>{const result=JSON.parse(data);if(result.type==='error'&&result.message==='Please sign in'){clearTimeout(timer);ws.close();resolve();}else{clearTimeout(timer);ws.terminate();reject(Error('Unexpected signaling response'));}});ws.on('error',e=>{clearTimeout(timer);reject(e);});});
  console.log('Cloudflare WebSocket signaling verified; unauthenticated access rejected.');
}finally{bridge.stop();}
