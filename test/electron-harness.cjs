module.exports=async({win,app,fs,screen})=>{
 const file=process.env.SI_REMOTE_E2E,role=process.env.SI_REMOTE_E2E_ROLE,login=JSON.parse(fs.readFileSync(process.env.SI_REMOTE_E2E_LOGIN,'utf8'));
 const clipboardTest=process.env.SI_REMOTE_CLIPBOARD_E2E==='1',testClipboard=require('electron').clipboard;
 if(clipboardTest){let value='not shared before opt-in';testClipboard.readText=async()=>value;testClipboard.writeText=async text=>{value=text;};testClipboard.availableFormats=async()=>['text/plain'];testClipboard.has=async()=>false;}
 const run=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(code,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){if(await run(code))return;await pause(200);}throw Error('Timed out: '+code);}
 try{
   await run(`window.si.login(${JSON.stringify({...login,remember:false})}).then(s=>render(s))`);
   await until('state?.connected');
   await run(`window.si.settings({name:${JSON.stringify('SI Remote E2E '+role)},unattended:${role==='host'}}).then(render)`);
   if(role==='host'){
     fs.writeFileSync(file,JSON.stringify({ready:true,input:await run('state.input')}));
     if(clipboardTest){fs.rmSync(file+'.clipboard',{force:true});fs.rmSync(file+'.clipboard-error',{force:true});}
     if(clipboardTest)(async()=>{try{
       for(const relay of [false,true]){
         await until('current?.relay==='+relay+' && current?.clipboardChannel?.readyState==="open"');
         await run('window.si.clipboardEnable({session:current.id,enabled:true}).then(b=>{renderClipboard(b);current.clipboardChannel.send("S1")})');
         await until('current.peerClipboardEnabled');await testClipboard.writeText('host clipboard '+relay);
         await until('clipboardState.entries.some(e=>e.text==='+JSON.stringify('viewer clipboard '+relay)+')');
         if((await testClipboard.readText())!=='viewer clipboard '+relay)throw Error('Host clipboard was not updated from peer');
         fs.appendFileSync(file+'.clipboard',JSON.stringify({relay,received:true})+'\n');
       }
     }catch(e){fs.writeFileSync(file+'.clipboard-error',e.message);}})();
     setInterval(async()=>{try{if(await run('current?.pc?.connectionState==="connected"'))fs.writeFileSync(file+'.media',JSON.stringify(await run('(async()=>({status:document.getElementById("sharing-stats").textContent,stats:[...(await current.pc.getStats()).values()].filter(r=>r.type==="outbound-rtp"&&r.kind==="video")}))()')));}catch{}},1500).unref();
     setTimeout(()=>app.exit(0),180000).unref();return;
   }
   await until('state.devices.some(d=>d.name==="SI Remote E2E host"&&d.online)');
   await run('window.si.connect(state.devices.find(d=>d.name==="SI Remote E2E host"&&d.online).id)');
   await until('current?.pc?.connectionState==="connected" && document.getElementById("remote-video").videoWidth>0');
   await pause(2200);
   if(clipboardTest){await until('current?.clipboardChannel?.readyState==="open"');await run('window.si.clipboardEnable({session:current.id,enabled:true}).then(b=>{renderClipboard(b);current.clipboardChannel.send("S1")})');await until('clipboardState.entries.some(e=>e.text==='+JSON.stringify('host clipboard false')+')');if((await testClipboard.readText())!=='host clipboard false')throw Error('Viewer clipboard was not updated from peer');await testClipboard.writeText('viewer clipboard false');await pause(1200);await run('openClipboard()');await win.capturePage().then(image=>fs.writeFileSync(file+'.clipboard.png',image.toPNG()));await run('document.getElementById("clipboard-dialog").close()');}

   const direct=await run('(async()=>({connection:current.pc.connectionState,width:document.getElementById("remote-video").videoWidth,height:document.getElementById("remote-video").videoHeight,route:document.getElementById("route").textContent,media:document.getElementById("viewer-stats").textContent,videoStats:[...(await current.pc.getStats()).values()].filter(r=>r.type==="inbound-rtp"&&r.kind==="video")}))()');
   await run('control({kind:"key",code:"ShiftLeft",down:true});control({kind:"key",code:"ShiftLeft",down:false})');
   await pause(300);
   await run('window.si.signal({session:current.id,payload:{kind:"restart",relay:true}}).then(()=>offer(current,true))');
   await until('current?.relay && current?.pc?.connectionState==="connected"');
   await pause(2200);
   if(clipboardTest){await until('current?.clipboardChannel?.readyState==="open"');await run('window.si.clipboardEnable({session:current.id,enabled:true}).then(b=>{renderClipboard(b);current.clipboardChannel.send("S1")})');await until('clipboardState.entries.some(e=>e.text==='+JSON.stringify('host clipboard true')+')');if((await testClipboard.readText())!=='host clipboard true')throw Error('Relay clipboard was not updated');await testClipboard.writeText('viewer clipboard true');await pause(1200);}
   const relay=await run('(async()=>({connection:current.pc.connectionState,width:document.getElementById("remote-video").videoWidth,route:document.getElementById("route").textContent,media:document.getElementById("viewer-stats").textContent,videoStats:[...(await current.pc.getStats()).values()].filter(r=>r.type==="inbound-rtp"&&r.kind==="video")}))()');
   if(relay.route!=='Encrypted relay')throw Error('Relay route was not selected: '+relay.route);
   await run('window.si.end(current.id)');await pause(200);
   await win.capturePage().then(image=>fs.writeFileSync(file+'.png',image.toPNG()));
   fs.writeFileSync(file,JSON.stringify({ok:true,direct,relay},null,2));
   await run('window.si.logout()');app.exit(0);
 }catch(e){fs.writeFileSync(file,JSON.stringify({ok:false,error:e.message},null,2));console.error(e);app.exit(1);}
};
