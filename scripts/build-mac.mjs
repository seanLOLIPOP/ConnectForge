import {spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

if(process.platform!=='darwin')throw Error('Build Mac releases on macOS so the app and nested executables can be signed and verified.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(command,args){const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
// Ad-hoc signing fixes bundle integrity for local testing. Public distribution
// still requires a Developer ID identity and Apple notarization credentials.
const identity=process.env.SI_REMOTE_MAC_IDENTITY||'-';
run(process.execPath,[path.join(root,'node_modules/electron-builder/cli.js'),'--mac','zip','--x64','--arm64','--publish','never',`--config.mac.identity=${identity}`]);
for(const folder of ['mac','mac-arm64']){
  const app=path.join(root,'dist',folder,'SI Remote.app');
  if(!fs.existsSync(app))throw Error('Missing Mac app: '+app);
  const arch=folder==='mac'?'x64':'arm64',native=path.join(app,`Contents/Resources/app.asar.unpacked/node_modules/@koromix/koffi-darwin-${arch}/darwin_${arch}/koffi.node`);
  if(!fs.existsSync(native))throw Error('Missing native keyboard/mouse module for '+arch);
  run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app]);
  run('/usr/bin/codesign',['--verify','--strict','--verbose=2',native]);
  run('/usr/bin/codesign',['--verify','--strict','--verbose=2',path.join(app,'Contents/Resources/cloudflared/cloudflared')]);
}
console.log(identity==='-'?'Verified ad-hoc signed portable Mac apps. These are not notarized public-distribution builds.':'Verified signed portable Mac apps. Confirm notarization before public distribution.');

