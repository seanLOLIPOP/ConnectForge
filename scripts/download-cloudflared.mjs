import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const version='2026.6.1',root=path.resolve(import.meta.dirname,'..','vendor','cloudflared');fs.mkdirSync(root,{recursive:true});
const headers={'User-Agent':'SI-Remote-build'},apiHeaders={...headers,...(process.env.GITHUB_TOKEN?{Authorization:'Bearer '+process.env.GITHUB_TOKEN}:{})},response=await fetch(`https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${version}`,{headers:apiHeaders});if(!response.ok)throw Error('Official Cloudflare release metadata unavailable: '+response.status);const release=await response.json();
const platforms={'win32-x64':'cloudflared-windows-amd64.exe','linux-x64':'cloudflared-linux-amd64','darwin-x64':'cloudflared-darwin-amd64.tgz','darwin-arm64':'cloudflared-darwin-arm64.tgz'};
const manifest=[];
await Promise.all(Object.entries(platforms).map(async([platform,name])=>{
  const asset=release.assets.find(a=>a.name===name);if(!asset?.digest?.startsWith('sha256:'))throw Error('Missing official SHA-256 for '+name);
  const dir=path.join(root,platform);fs.mkdirSync(dir,{recursive:true});const r=await fetch(asset.browser_download_url);if(!r.ok)throw Error('Download failed: '+name);const data=Buffer.from(await r.arrayBuffer()),digest=createHash('sha256').update(data).digest('hex');if('sha256:'+digest!==asset.digest)throw Error('Checksum failed: '+name);
  if(name.endsWith('.tgz')){const archive=path.join(dir,'download.tgz');fs.writeFileSync(archive,data);execFileSync('tar',['-xzf',archive,'-C',dir]);fs.unlinkSync(archive);}else fs.writeFileSync(path.join(dir,platform.startsWith('win32')?'cloudflared.exe':'cloudflared'),data,{mode:0o755});
  const binary=path.join(dir,platform.startsWith('win32')?'cloudflared.exe':'cloudflared');if(process.platform!=='win32')fs.chmodSync(binary,0o755);manifest.push({platform,name,version,sha256:digest,url:asset.browser_download_url});console.log('Verified official Cloudflare helper: '+platform);
}));
const license=await fetch(`https://raw.githubusercontent.com/cloudflare/cloudflared/${version}/LICENSE`,{headers});if(!license.ok)throw Error('Cloudflare license unavailable');fs.writeFileSync(path.join(root,'LICENSE.txt'),await license.text());fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));for(const platform of Object.keys(platforms)){for(const name of ['LICENSE.txt','manifest.json'])fs.copyFileSync(path.join(root,name),path.join(root,platform,name));}

