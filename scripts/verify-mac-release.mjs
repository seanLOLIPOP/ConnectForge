import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

if(process.platform!=='darwin')throw Error('macOS is required');
const root=path.resolve(import.meta.dirname,'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'si-remote-release-'));
function run(command,args,options={}){
  const result=spawnSync(command,args,{encoding:'utf8',timeout:60000,...options});
  if(result.error||result.status!==0)throw Error(`${command}: ${result.error||result.stderr||result.stdout}`);
  return result.stdout;
}
const assets=[];
for(const arch of ['x64','arm64']){
  const name=`SI-Remote-${version}-macOS-${arch}.zip`,zip=path.join(root,'dist',name);
  const destination=path.join(temp,arch);
  run('/usr/bin/ditto',['-x','-k',zip,destination]);
  const app=path.join(destination,'SI Remote.app');
  run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
  const native=path.join(app,`Contents/Resources/app.asar.unpacked/node_modules/@koromix/koffi-darwin-${arch}/darwin_${arch}/koffi.node`);
  run('/usr/bin/codesign',['--verify','--strict',native]);
  run('/usr/bin/codesign',['--verify','--strict',path.join(app,'Contents/Resources/cloudflared/cloudflared')]);
  const executable=path.join(app,'Contents/MacOS/SI Remote');
  const expected=arch==='x64'?'x86_64':'arm64';
  if(!run('/usr/bin/lipo',['-archs',executable]).includes(expected))throw Error('Wrong executable architecture');
  if(run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(app,'Contents/Info.plist')]).trim()!==version)throw Error('Wrong app version');
  if(arch===process.arch){
    const screenshot=path.join(temp,'smoke.png');
    const profile=path.join(temp,'original profile'),data=path.join(temp,'existing data');
    run(executable,['--si-remote-profile='+profile,'--si-remote-data-dir='+data],{env:{...process.env,SI_REMOTE_SMOKE:screenshot},timeout:30000});
    if(fs.statSync(screenshot).size<1000)throw Error('Missing launch screenshot');
    if(JSON.parse(fs.readFileSync(screenshot+'.json')).dataDir!==data)throw Error('Explicit update data folder was not retained');
    if(fs.existsSync(profile))throw Error('Launch unexpectedly wrote to the original app location');
  }
  assets.push({name,bytes:fs.statSync(zip).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex')});
}
fs.writeFileSync(path.join(root,'dist',`SHA256SUMS-macOS-${version}.txt`),assets.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');
fs.writeFileSync(path.join(root,'dist',`macOS-build-${version}.json`),JSON.stringify({version,sourceCommit:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,signing:'ad-hoc; not Apple notarized',checks:['ZIP extraction','strict bundle signatures','native input module signatures','Cloudflare helper signatures','executable architecture','bundle version',`native ${process.arch} app launch`],assets},null,2)+'\n');
console.log('Verified Mac ZIPs:',assets);
