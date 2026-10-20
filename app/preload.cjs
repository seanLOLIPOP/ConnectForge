const {contextBridge,ipcRenderer}=require('electron');
const invoke=async(name,...args)=>{const result=await ipcRenderer.invoke('si:'+name,...args);if(!result.ok)throw Error(result.error);return result.value;};
contextBridge.exposeInMainWorld('si',{
  state:()=>invoke('state'),login:b=>invoke('login',b),logout:()=>invoke('logout'),settings:b=>invoke('settings',b),connect:id=>invoke('connect',id),approve:id=>invoke('approve',id),signal:b=>invoke('signal',b),end:id=>invoke('end',id),remove:id=>invoke('remove',id),input:b=>invoke('input',b),release:id=>invoke('release',id),diagnostics:()=>invoke('diagnostics'),
  onEvent:callback=>{const fn=(_,b)=>callback(b);ipcRenderer.on('si:event',fn);return()=>ipcRenderer.removeListener('si:event',fn);}
});
