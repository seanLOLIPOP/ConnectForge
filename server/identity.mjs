import fs from 'node:fs';
import {scrypt as derive, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive);
// Only these two read operations are used. The SI database stays private on loopback.
export function siIdentity({url='http://127.0.0.1:8099',tokenFile}) {
  const token=fs.readFileSync(tokenFile,'utf8').trim();
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)||token.length<32)throw Error('Invalid SI identity connection');
  async function call(method,args){
    const r=await fetch(url+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({method,args}),signal:AbortSignal.timeout(5000)});
    if(!r.ok)throw Object.assign(Error('SI account service is unavailable'),{status:503});
    return (await r.json()).value;
  }
  return {findEmail:email=>call('findEmail',[email]),user:id=>call('user',[id])};
}
export async function verifyLogin(identity,email,password){
  if(typeof email!=='string'||email.length>254||typeof password!=='string'||password.length<10||password.length>128)throw Object.assign(Error('Enter your SI email and password'),{status:400});
  const u=await identity.findEmail(email.trim().toLowerCase());
  const expected=Buffer.from(u?.hash||'00'.repeat(64),'hex');
  const actual=await scrypt(password,u?.salt||'si-remote-dummy-salt',64);
  if(!u||expected.length!==actual.length||!timingSafeEqual(actual,expected))throw Object.assign(Error('Email or password is incorrect'),{status:401});
  return u;
}
