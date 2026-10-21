'use strict';
const fs=require('node:fs'),https=require('node:https'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Transform}=require('node:stream');
function allowedURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw Error('Untrusted update download URL');return u;}
async function matches(file,asset){const h=crypto.createHash('sha256');let n=0;for await(const b of fs.createReadStream(file)){h.update(b);n+=b.length;if(n>asset.bytes)return false;}return n===asset.bytes&&h.digest('hex')===asset.sha256;}
function createDownloader({get=https.get,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 return async function download(url,file,asset,onProgress=()=>{}){
  allowedURL(url);
  const began=Date.now();let base=fs.existsSync(file)?fs.statSync(file).size:0,last=0;
  if(base>asset.bytes){fs.rmSync(file);base=0;}
  function progress(received,stage='downloading',attempt=0){const now=Date.now();if(stage==='downloading'&&now-last<500&&received!==asset.bytes)return;last=now;const speed=Math.max(0,received-base)/Math.max((now-began)/1000,0.001);onProgress({stage,received,total:asset.bytes,percent:Math.floor(received/asset.bytes*100),bytesPerSecond:speed,secondsRemaining:speed>0?Math.ceil((asset.bytes-received)/speed):null,attempt});}
  async function transfer(address,offset,redirects=0){
   if(redirects>5)throw Object.assign(Error('Too many download redirects'),{permanent:true});
   const u=allowedURL(address);
   const res=await new Promise((resolve,reject)=>{const req=get(u,{headers:{'User-Agent':'ConnectForge-Updater','Accept-Encoding':'identity',...(offset?{Range:`bytes=${offset}-`}:{})}},resolve);req.setTimeout(30000,()=>req.destroy(Error('Update download stalled; retrying')));req.on('error',reject);});
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();return transfer(new URL(res.headers.location,u).href,offset,redirects+1);}
   if(res.statusCode!==200&&res.statusCode!==206){res.resume();throw Object.assign(Error('Release download failed: '+res.statusCode),{permanent:![408,429,500,502,503,504].includes(res.statusCode)});}
   let start=offset;
   if(res.statusCode===206){const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers['content-range']||'');if(!range||Number(range[1])!==offset||Number(range[2])!==asset.bytes-1||Number(range[3])!==asset.bytes){res.destroy();throw Object.assign(Error('Invalid update download range'),{permanent:true});}}
   else start=0; // A server without range support must replace, never append.
   let received=start;
   const count=new Transform({transform(chunk,encoding,done){received+=chunk.length;if(received>asset.bytes)return done(Object.assign(Error('Update download exceeds signed size'),{permanent:true}));progress(received);done(null,chunk);}});
   await pipeline(res,count,fs.createWriteStream(file,{flags:start?'a':'w',mode:0o600}));
   if(received!==asset.bytes)throw Error('Update download interrupted');
  }
  for(let attempt=0;attempt<4;attempt++){
   try{
    const offset=fs.existsSync(file)?fs.statSync(file).size:0;
    if(offset<asset.bytes){progress(offset);await transfer(url,offset);}
    progress(asset.bytes,'verifying');
    if(!await matches(file,asset)){fs.rmSync(file,{force:true});throw Object.assign(Error('Update checksum verification failed'),{permanent:true});}
    progress(asset.bytes,'complete');return;
   }catch(error){if(error.permanent||attempt===3)throw error;progress(fs.existsSync(file)?fs.statSync(file).size:0,'retrying',attempt+1);await wait(1000*2**attempt);}
  }
 };
}
module.exports={allowedURL,matches,createDownloader,download:createDownloader()};

