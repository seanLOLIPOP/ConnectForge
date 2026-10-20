'use strict';
const crypto=require('node:crypto');
const repo='https://github.com/seanLOLIPOP/ConnectForge/releases/download/';
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function version(v){if(typeof v!=='string'||!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v))throw Error('Invalid release version');return v.split('.').map(Number);}
function newer(a,b){const x=version(a),y=version(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
function filename(v,p,a){version(v);if(p==='win32'&&a==='x64')return `SI-Remote-${v}-Windows-Portable.exe`;if(p==='linux'&&a==='x64')return `SI-Remote-${v}-Linux-x64.AppImage`;if(p==='darwin'&&['arm64','x64'].includes(a))return `SI-Remote-${v}-macOS-${a}.zip`;throw Error('Unsupported update platform');}
function verify(envelope,key){
 if(!envelope||typeof envelope.signature!=='string'||!envelope.manifest||Buffer.byteLength(JSON.stringify(envelope))>14000)throw Error('Invalid update manifest');
 const m=envelope.manifest;version(m.version);
 if(m.schema!==1||m.appId!=='com.si.remote'||!Number.isFinite(Date.parse(m.publishedAt))||!Array.isArray(m.assets)||m.assets.length<1||m.assets.length>4)throw Error('Invalid update manifest');
 const seen=new Set();for(const a of m.assets){const name=filename(m.version,a.platform,a.arch),id=a.platform+'/'+a.arch;if(seen.has(id)||a.url!==repo+'v'+m.version+'/'+name||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>1024*1024*1024)throw Error('Invalid update artifact');seen.add(id);}
 if(!crypto.verify(null,Buffer.from(canonical(m)),key,Buffer.from(envelope.signature,'base64')))throw Error('Update signature is invalid');return m;
}
module.exports={canonical,version,newer,filename,verify};
