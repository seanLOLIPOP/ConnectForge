// Isolated, temporary test identity. Never reads or changes production SI users.
import fs from 'node:fs';import {randomBytes,scryptSync} from 'node:crypto';import {createService} from './service.mjs';
const dir=new URL('../data/',import.meta.url),config=JSON.parse(fs.readFileSync(new URL('server.json',dir))),password=randomBytes(32).toString('hex'),salt=randomBytes(16).toString('hex');
const u={id:'si-remote-e2e',username:'Connection test',email:'connection-test@si.invalid',salt,hash:scryptSync(password,salt,64).toString('hex')};
const identity={findEmail:async e=>e===u.email?u:null,user:async id=>id===u.id?u:null};
const service=createService({identity,tls:{key:fs.readFileSync(config.key),cert:fs.readFileSync(config.cert)},turnHost:config.turnHost,turnSecret:fs.readFileSync(config.turnSecretFile,'utf8').trim(),cloudflareRelayHost:process.env.SI_REMOTE_TEST_CLOUDFLARE==='1'?'connectforge-relay.mcseanilog.com':''});
fs.writeFileSync(new URL('e2e-login.json',dir),JSON.stringify({email:u.email,password}),{mode:0o600});
service.server.listen(8444,'0.0.0.0',()=>console.log('Isolated connection test ready'));
setTimeout(()=>service.close().then(()=>process.exit()),15*60000).unref();process.on('SIGTERM',()=>service.close().then(()=>process.exit()));
