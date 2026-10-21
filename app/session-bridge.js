'use strict';
if(window.parent!==window){
 const id=new URLSearchParams(location.search).get('workspaceDevice');
 if(!id||!window.parent.SIWorkspace)throw Error('Invalid workspace view');
 document.documentElement.classList.add('session-child');
 window.SISessionAPI=window.parent.SIWorkspace.client(id,window);
}
