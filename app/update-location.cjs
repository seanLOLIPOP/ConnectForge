'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function probe(directory){
 const file=path.join(directory,'.si-write-'+crypto.randomBytes(8).toString('hex'));let fd;
 try{fd=fs.openSync(file,'wx',0o600);}finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(file);}}
}
const fallbackRoot=dataDir=>path.join(dataDir,'Updates');
function updateRoot(root,dataDir,{check=probe,mkdir=directory=>fs.mkdirSync(directory,{recursive:true,mode:0o700})}={}){
 try{check(root);return root;}catch(e){if(!['EROFS','EACCES','EPERM','ENOENT'].includes(e.code))throw e;}
 const fallback=fallbackRoot(dataDir);mkdir(fallback);check(fallback);return fallback;
}
function receiptRoot(receipt,root,dataDir){
 const selected=receipt.updateRoot||root;
 if(![root,fallbackRoot(dataDir)].some(p=>path.resolve(p)===path.resolve(selected)))throw Error('Invalid update storage location');
 return selected;
}
module.exports={updateRoot,receiptRoot};
