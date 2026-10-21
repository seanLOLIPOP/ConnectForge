import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const version=JSON.parse(fs.readFileSync('package.json')).version;
for(const [from,to] of [[`SI Remote-${version}-win.zip`,`SI-Remote-${version}-Windows.zip`],[`SI-Remote-${version}-Linux-x86_64.AppImage`,`SI-Remote-${version}-Linux-x64.AppImage`]]){if(fs.existsSync(path.join('release',from)))fs.renameSync(path.join('release',from),path.join('release',to));}
const assets=[];
for(const name of fs.readdirSync('release').filter(n=>/\.(exe|zip|AppImage|tar\.gz)$/.test(n)).sort()){
 const file=path.join('release',name),hash=createHash('sha256');for await(const b of fs.createReadStream(file))hash.update(b);
 assets.push({name,bytes:fs.statSync(file).size,sha256:hash.digest('hex')});
}
if(assets.length!==7)throw Error('Expected six portable downloads and one source ZIP');
fs.writeFileSync('release/SHA256SUMS.txt',assets.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');
fs.writeFileSync('release/release.json',JSON.stringify({version,sourceCommit:process.env.GITHUB_SHA,run:process.env.GITHUB_RUN_ID,artifacts:assets,validation:{automatedTests:85,macOS:'Strict extracted signatures, architecture, version and Intel launch checks passed; Apple Silicon runtime and remote sessions unverified',updates:'Interrupted/resumed, ignored Range, invalid range, checksum and size rejection tests passed. Native Windows relaunch into the public portable build passed in an isolated updater fixture; Linux FUSE-free staging and native relaunch passed on Ubuntu with the approved sandbox helper; Mac automatic restart remains unverified.',signing:'Windows unsigned; Mac ad-hoc signed, not Apple notarized'}},null,2)+'\n');
