'use strict';
const {spawn}=require('node:child_process');const net=require('node:net');const fs=require('node:fs');const path=require('node:path');
// TCP bytes are carried through Cloudflare's authenticated tunnel. The API keeps
// its own verified TLS connection, and WebRTC keeps its DTLS media encryption.
function createCloudflare({packaged,resourcesPath}){
  const bridges=new Map();let stopped=false;
  const executable=packaged?path.join(resourcesPath,'cloudflared',process.platform==='win32'?'cloudflared.exe':'cloudflared'):path.join(__dirname,'../vendor/cloudflared',process.platform+'-'+process.arch,process.platform==='win32'?'cloudflared.exe':'cloudflared');
  async function bridge(hostname){
    if(!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(hostname)||!hostname.includes('.'))throw Error('Invalid Cloudflare hostname');
    if(stopped)throw Error('Application is closing');
    if(bridges.has(hostname))return bridges.get(hostname).promise;
    const record={child:null,promise:null};bridges.set(hostname,record);
    record.promise=(async()=>{
      if(!fs.existsSync(executable))throw Error('The portable Cloudflare helper is missing. Extract the complete app package.');
      const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});const port=listener.address().port;await new Promise(r=>listener.close(r));
      if(stopped)throw Error('Application is closing');
      const child=spawn(executable,['access','tcp','--hostname',hostname,'--url','127.0.0.1:'+port],{windowsHide:true,stdio:['ignore','ignore','ignore']});record.child=child;let exited=false;
      child.on('error',()=>{exited=true;if(bridges.get(hostname)===record)bridges.delete(hostname);});child.on('exit',()=>{exited=true;if(bridges.get(hostname)===record)bridges.delete(hostname);});
      for(let i=0;i<100;i++){
        if(stopped||exited)break;
        const ready=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.setTimeout(150);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});
        if(ready)return port;
        await new Promise(r=>setTimeout(r,100));
      }
      child.kill();throw Error('The Cloudflare connection helper could not start');
    })().catch(e=>{if(bridges.get(hostname)===record)bridges.delete(hostname);throw e;});
    return record.promise;
  }
  const stop=()=>{stopped=true;for(const r of bridges.values())r.child?.kill();bridges.clear();};process.once('exit',stop);return {bridge,stop};
}
module.exports={createCloudflare};
