const {contextBridge,ipcRenderer}=require('electron');
const invoke=async(name,...args)=>{const r=await ipcRenderer.invoke('admin:'+name,...args);if(!r.ok)throw Error(r.error);return r.value;};
contextBridge.exposeInMainWorld('admin',{login:b=>invoke('login',b),logout:()=>invoke('logout'),refresh:()=>invoke('refresh'),import:v=>invoke('import',v),push:b=>invoke('push',b),cancel:id=>invoke('cancel',id)});
