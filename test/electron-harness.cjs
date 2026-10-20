module.exports=async({win,app,fs,screen})=>{
 const file=process.env.SI_REMOTE_E2E,role=process.env.SI_REMOTE_E2E_ROLE,login=JSON.parse(fs.readFileSync(process.env.SI_REMOTE_E2E_LOGIN,'utf8'));
 const run=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(code,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){if(await run(code))return;await pause(200);}throw Error('Timed out: '+code);}
 try{
   await run(`window.si.login(${JSON.stringify({...login,remember:false})}).then(s=>render(s))`);
   await until('state?.connected');
   await run(`window.si.settings({name:${JSON.stringify('SI Remote E2E '+role)},unattended:${role==='host'}}).then(render)`);
   if(role==='host'){
     fs.writeFileSync(file,JSON.stringify({ready:true,input:await run('state.input')}));
     setInterval(async()=>{try{if(await run('current?.pc?.connectionState==="connected"'))fs.writeFileSync(file+'.media',JSON.stringify(await run('(async()=>({status:document.getElementById("sharing-stats").textContent,stats:[...(await current.pc.getStats()).values()].filter(r=>r.type==="outbound-rtp"&&r.kind==="video")}))()')));}catch{}},1500).unref();
     setTimeout(()=>app.exit(0),180000).unref();return;
   }
   await until('state.devices.some(d=>d.name==="SI Remote E2E host"&&d.online)');
   await run('window.si.connect(state.devices.find(d=>d.name==="SI Remote E2E host").id)');
   await until('current?.pc?.connectionState==="connected" && document.getElementById("remote-video").videoWidth>0');
   await pause(2200);
   const direct=await run('(async()=>({connection:current.pc.connectionState,width:document.getElementById("remote-video").videoWidth,height:document.getElementById("remote-video").videoHeight,route:document.getElementById("route").textContent,media:document.getElementById("viewer-stats").textContent,videoStats:[...(await current.pc.getStats()).values()].filter(r=>r.type==="inbound-rtp"&&r.kind==="video")}))()');
   await run('control({kind:"key",code:"ShiftLeft",down:true});control({kind:"key",code:"ShiftLeft",down:false})');
   await pause(300);
   await run('window.si.signal({session:current.id,payload:{kind:"restart",relay:true}}).then(()=>offer(current,true))');
   await until('current?.relay && current?.pc?.connectionState==="connected"');
   await pause(2200);
   const relay=await run('(async()=>({connection:current.pc.connectionState,width:document.getElementById("remote-video").videoWidth,route:document.getElementById("route").textContent,media:document.getElementById("viewer-stats").textContent,videoStats:[...(await current.pc.getStats()).values()].filter(r=>r.type==="inbound-rtp"&&r.kind==="video")}))()');
   if(relay.route!=='Encrypted relay')throw Error('Relay route was not selected: '+relay.route);
   await run('window.si.end(current.id)');await pause(200);
   await win.capturePage().then(image=>fs.writeFileSync(file+'.png',image.toPNG()));
   fs.writeFileSync(file,JSON.stringify({ok:true,direct,relay},null,2));
   await run('window.si.logout()');app.exit(0);
 }catch(e){fs.writeFileSync(file,JSON.stringify({ok:false,error:e.message},null,2));console.error(e);app.exit(1);}
};
