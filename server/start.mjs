import fs from 'node:fs';import path from 'node:path';import {siIdentity} from './identity.mjs';import {createService} from './service.mjs';
const dir=process.env.SI_REMOTE_DATA||new URL('../data/',import.meta.url).pathname;fs.mkdirSync(dir,{recursive:true,mode:0o700});
const config=JSON.parse(fs.readFileSync(process.env.SI_REMOTE_CONFIG||path.join(dir,'server.json'),'utf8'));
const service=createService({identity:siIdentity({tokenFile:config.identityTokenFile}),database:path.join(dir,'remote.sqlite'),tls:{key:fs.readFileSync(config.key),cert:fs.readFileSync(config.cert)},turnSecret:config.turnSecretFile?fs.readFileSync(config.turnSecretFile,'utf8').trim():'',turnHost:config.turnHost,turnPort:config.turnPort||3478,cloudflareRelayHost:config.cloudflareRelayHost||''});
service.server.listen(config.port||8443,config.bind||'0.0.0.0',()=>console.log('SI Remote listening on '+(config.port||8443)));
process.on('SIGTERM',()=>service.close().then(()=>process.exit(0)));
