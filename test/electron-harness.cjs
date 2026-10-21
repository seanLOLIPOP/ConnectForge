module.exports=async({win,app,fs,screen})=>{
 const file=process.env.SI_REMOTE_E2E,role=process.env.SI_REMOTE_E2E_ROLE,login=JSON.parse(fs.readFileSync(process.env.SI_REMOTE_E2E_LOGIN,'utf8'));
 const clipboardTest=process.env.SI_REMOTE_CLIPBOARD_E2E==='1',performanceTest=process.env.SI_REMOTE_PERFORMANCE_E2E==='1',testClipboard=require('electron').clipboard;
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
     if(performanceTest)setInterval(async()=>{try{if(await run('current?.pc?.connectionState==="connected"')){win.hide();fs.writeFileSync(file+'.background',JSON.stringify({hidden:!win.isVisible(),backgroundThrottling:win.webContents.backgroundThrottling,track:await run('current.stream.getVideoTracks()[0].getSettings()'),parameters:await run('current.pc.getSenders().find(s=>s.track?.kind==="video").getParameters()')}));}}catch{}},1000).unref();
     setInterval(async()=>{try{if(await run('current?.pc?.connectionState==="connected"'))fs.writeFileSync(file+'.media',JSON.stringify(await run('(async()=>({status:document.getElementById("sharing-stats").textContent,stats:[...(await current.pc.getStats()).values()].filter(r=>r.type==="outbound-rtp"&&r.kind==="video")}))()')));}catch{}},1500).unref();
     setTimeout(()=>app.exit(0),180000).unref();return;
   }
   await until('state.devices.some(d=>d.name==="SI Remote E2E host"&&d.online)');
   await run('window.si.connect(state.devices.find(d=>d.name==="SI Remote E2E host"&&d.online).id)');
   await until('current?.pc?.connectionState==="connected" && document.getElementById("remote-video").videoWidth>0');
   await pause(2200);
   if(process.env.SI_REMOTE_EXPECT_LEGACY==='1'&&!await run('current.peerInputVersion===0 && !current.motionChannel'))throw Error('Legacy input fallback was not selected');
   const performanceResults=[];
   async function checkPerformance(relay){
     await until('current?.channel?.readyState==="open" && current?.motionChannel?.readyState==="open"');
     const report=await run('(async()=>{const s=current;for(let i=0;i<1000;i++)control({kind:"move",x:.3+i/10000,y:.4});await new Promise(r=>setTimeout(r,100));return {motionOrdered:s.motionChannel.ordered,retransmits:s.motionChannel.maxRetransmits,reliableOrdered:s.channel.ordered,reliableRetransmits:s.channel.maxRetransmits,motion:[...(await s.pc.getStats()).values()].filter(r=>r.type==="data-channel"&&r.label==="motion-v1"),buffered:s.motionChannel.bufferedAmount,receiverTarget:s.pc.getReceivers().find(r=>r.track.kind==="video").jitterBufferTarget};})()');
     if(report.motionOrdered!==false||report.retransmits!==0||!report.reliableOrdered||report.reliableRetransmits!==null)throw Error('Incorrect input delivery guarantees');
     if(report.buffered>1024||report.motion[0]?.messagesSent>20)throw Error('Mouse burst built a stale queue');
     performanceResults.push({relay,...report});
   }
   if(performanceTest)await checkPerformance(false);
   if(clipboardTest){await until('current?.clipboardChannel?.readyState==="open"');await run('window.si.clipboardEnable({session:current.id,enabled:true}).then(b=>{renderClipboard(b);current.clipboardChannel.send("S1")})');await until('clipboardState.entries.some(e=>e.text==='+JSON.stringify('host clipboard false')+')');if((await testClipboard.readText())!=='host clipboard false')throw Error('Viewer clipboard was not updated from peer');await testClipboard.writeText('viewer clipboard false');await pause(1200);await run('openClipboard()');await win.capturePage().then(image=>fs.writeFileSync(file+'.clipboard.png',image.toPNG()));await run('document.getElementById("clipboard-dialog").close()');}

   const direct=await run('(async()=>({connection:current.pc.connectionState,width:document.getElementById("remote-video").videoWidth,height:document.getElementById("remote-video").videoHeight,route:document.getElementById("route").textContent,media:document.getElementById("viewer-stats").textContent,videoStats:[...(await current.pc.getStats()).values()].filter(r=>r.type==="inbound-rtp"&&r.kind==="video")}))()');
   await run('control({kind:"key",code:"ShiftLeft",down:true});control({kind:"key",code:"ShiftLeft",down:false})');
   await pause(300);
   await run('window.si.signal({session:current.id,payload:{kind:"restart",relay:true}}).then(()=>offer(current,true))');
   await until('current?.relay && current?.pc?.connectionState==="connected"');
   await pause(2200);
   if(performanceTest)await checkPerformance(true);
   if(clipboardTest){await until('current?.clipboardChannel?.readyState==="open"');await run('window.si.clipboardEnable({session:current.id,enabled:true}).then(b=>{renderClipboard(b);current.clipboardChannel.send("S1")})');await until('clipboardState.entries.some(e=>e.text==='+JSON.stringify('host clipboard true')+')');if((await testClipboard.readText())!=='host clipboard true')throw Error('Relay clipboard was not updated');await testClipboard.writeText('viewer clipboard true');await pause(1200);}
   const relay=await run('(async()=>({connection:current.pc.connectionState,width:document.getElementById("remote-video").videoWidth,route:document.getElementById("route").textContent,media:document.getElementById("viewer-stats").textContent,videoStats:[...(await current.pc.getStats()).values()].filter(r=>r.type==="inbound-rtp"&&r.kind==="video")}))()');
   if(relay.route!=='Encrypted relay')throw Error('Relay route was not selected: '+relay.route);
   await run('window.si.end(current.id)');await pause(200);
   await win.capturePage().then(image=>fs.writeFileSync(file+'.png',image.toPNG()));
   fs.writeFileSync(file,JSON.stringify({ok:true,direct,relay,...(performanceTest?{performance:performanceResults}:{})},null,2));
   await run('window.si.logout()');app.exit(0);
 }catch(e){fs.writeFileSync(file,JSON.stringify({ok:false,error:e.message},null,2));console.error(e);app.exit(1);}
};
