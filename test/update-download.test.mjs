import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import downloader from '../app/update-download.cjs';
const bytes=Buffer.alloc(256*1024,73),asset={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
async function fixture(t,handler){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'si-download-'));const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();fs.rmSync(dir,{recursive:true,force:true});});const get=(url,options,callback)=>http.get('http://127.0.0.1:'+server.address().port,{...options,agent:false},callback);return {file:path.join(dir,'update.part'),download:downloader.createDownloader({get,wait:async()=>{}})};}
test('interrupted downloads retry from the saved offset and verify the complete artifact',async t=>{
 let calls=0;const ranges=[];
 const s=await fixture(t,(req,res)=>{ranges.push(req.headers.range);if(calls++===0){res.writeHead(200,{'Content-Length':bytes.length});res.write(bytes.subarray(0,65536));// Interrupt only after the client has persisted data; a fixed delay races Windows CI I/O.
 const timeout=setTimeout(()=>{clearInterval(persisted);res.destroy();},5000);
 const persisted=setInterval(()=>{if(fs.existsSync(s.file)&&fs.statSync(s.file).size>0){clearInterval(persisted);clearTimeout(timeout);res.destroy();}},5);
 t.after(()=>{clearInterval(persisted);clearTimeout(timeout);});}else{const start=Number(req.headers.range.match(/\d+/)[0]);res.writeHead(206,{'Content-Range':`bytes ${start}-${bytes.length-1}/${bytes.length}`});res.end(bytes.subarray(start));}});
 const progress=[];await s.download('https://github.com/test',s.file,asset,p=>progress.push(p));assert.equal(calls,2);assert.match(ranges[1],/^bytes=\d+-$/);const resumedOffset=Number(ranges[1].match(/\d+/)[0]);assert.ok(resumedOffset>0&&resumedOffset<=65536);assert.deepEqual(fs.readFileSync(s.file),bytes);assert.ok(progress.some(p=>p.stage==='retrying'));assert.equal(progress.at(-1).stage,'complete');
});
test('a later attempt resumes an existing partial download',async t=>{const s=await fixture(t,(req,res)=>{assert.equal(req.headers.range,'bytes=8192-');res.writeHead(206,{'Content-Range':`bytes 8192-${bytes.length-1}/${bytes.length}`});res.end(bytes.subarray(8192));});fs.writeFileSync(s.file,bytes.subarray(0,8192));await s.download('https://github.com/test',s.file,asset);assert.deepEqual(fs.readFileSync(s.file),bytes);});
test('servers ignoring Range replace the partial file instead of appending',async t=>{const s=await fixture(t,(req,res)=>res.end(bytes));fs.writeFileSync(s.file,bytes.subarray(0,100));await s.download('https://github.com/test',s.file,asset);assert.deepEqual(fs.readFileSync(s.file),bytes);});
test('wrong ranges cannot produce an installable file',async t=>{const s=await fixture(t,(req,res)=>{res.writeHead(206,{'Content-Range':`bytes 0-${bytes.length-1}/${bytes.length}`});res.end(bytes);});fs.writeFileSync(s.file,bytes.subarray(0,100));await assert.rejects(s.download('https://github.com/test',s.file,asset),/range/);});
test('checksum failure deletes poisoned partial data without retrying it',async t=>{let calls=0;const s=await fixture(t,(req,res)=>{calls++;res.end(Buffer.alloc(bytes.length,1));});await assert.rejects(s.download('https://github.com/test',s.file,asset),/checksum/);assert.equal(calls,1);assert.equal(fs.existsSync(s.file),false);});
test('oversized downloads stop and never report complete',async t=>{const s=await fixture(t,(req,res)=>res.end(Buffer.alloc(bytes.length+1)));const progress=[];await assert.rejects(s.download('https://github.com/test',s.file,asset,p=>progress.push(p)),/signed size/);assert.equal(progress.some(p=>p.stage==='complete'),false);});
test('a complete cached download is verified without another network request',async t=>{const s=await fixture(t,()=>assert.fail('Unexpected network request'));fs.writeFileSync(s.file,bytes);await s.download('https://github.com/test',s.file,asset);});

