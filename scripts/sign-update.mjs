import fs from 'node:fs';import path from 'node:path';import {createHash,sign,generateKeyPairSync,createPublicKey} from 'node:crypto';import {fileURLToPath} from 'node:url';import tools from '../app/update-manifest.cjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const keyPath=process.env.SI_UPDATE_SIGNING_KEY;if(!keyPath)throw Error('Set SI_UPDATE_SIGNING_KEY to a private key outside the project.');
if(process.argv.includes('--init')){
 if(fs.existsSync(keyPath)||fs.existsSync(path.join(root,'assets/update-public.pem')))throw Error('Signing key already exists; refusing to rotate it');
 const keys=generateKeyPairSync('ed25519');fs.writeFileSync(keyPath,keys.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});fs.writeFileSync(path.join(root,'assets/update-public.pem'),keys.publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});console.log('Created private signing key outside the project and pinned public key.');
}else{
 const key=fs.readFileSync(keyPath),pub=fs.readFileSync(path.join(root,'assets/update-public.pem'),'utf8');if(createPublicKey(key).export({type:'spki',format:'pem'})!==pub)throw Error('Private key does not match the pinned public key');
 const assets=[];for(const [platform,arch] of [['win32','x64'],['linux','x64'],['darwin','arm64'],['darwin','x64']]){
  const name=tools.filename(version,platform,arch),file=path.join(root,'dist',name);if(!fs.existsSync(file))continue;
  const h=createHash('sha256');let bytes=0;for await(const b of fs.createReadStream(file)){h.update(b);bytes+=b.length;}
  assets.push({platform,arch,url:'https://github.com/seanLOLIPOP/ConnectForge/releases/download/v'+version+'/'+name,sha256:h.digest('hex'),bytes});
 }
 const manifest={schema:1,appId:'com.si.remote',version,publishedAt:new Date().toISOString(),assets},envelope={manifest,signature:sign(null,Buffer.from(tools.canonical(manifest)),key).toString('base64')};tools.verify(envelope,pub);fs.writeFileSync(path.join(root,'dist/update-manifest.json'),JSON.stringify(envelope,null,2));console.log('Signed '+assets.length+' update artifacts for '+version);
}
