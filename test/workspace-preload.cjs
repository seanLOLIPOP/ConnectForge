const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('si',{
 state:()=>ipcRenderer.invoke('workspace-smoke','state'),onEvent:fn=>ipcRenderer.on('mock-signal',(_,b)=>fn(b)),
 connect:b=>ipcRenderer.invoke('workspace-smoke','connect',b),signal:b=>ipcRenderer.invoke('workspace-smoke','signal',b),end:id=>ipcRenderer.invoke('workspace-smoke','end',id),
 files:b=>ipcRenderer.invoke('workspace-smoke','files',b),filesEnd:async()=>{},workspaceFiles:r=>ipcRenderer.invoke('workspace-smoke','local',r),
 workspaceHistory:()=>ipcRenderer.invoke('workspace-smoke','history'),workspaceCopy:id=>ipcRenderer.invoke('workspace-smoke','copy',id),workspaceClear:async()=>{},
 release:id=>ipcRenderer.invoke('workspace-smoke','release',id),input:b=>ipcRenderer.invoke('workspace-smoke','input',b),clipboardEnable:async()=>({enabled:false,items:[]}),clipboardList:async()=>({enabled:false,items:[]})
});
