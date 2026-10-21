'use strict';
const os=require('node:os');
const {createScrollAccumulator}=require('./latency.js');
const codeNames={Space:'space',Enter:'Return',Tab:'Tab',Escape:'Escape',Backspace:'BackSpace',Delete:'Delete',Insert:'Insert',Home:'Home',End:'End',PageUp:'Prior',PageDown:'Next',ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',ShiftLeft:'Shift_L',ShiftRight:'Shift_R',ControlLeft:'Control_L',ControlRight:'Control_R',AltLeft:'Alt_L',AltRight:'Alt_R',MetaLeft:'Super_L',MetaRight:'Super_R',CapsLock:'Caps_Lock',Minus:'minus',Equal:'equal',BracketLeft:'bracketleft',BracketRight:'bracketright',Backslash:'backslash',Semicolon:'semicolon',Quote:'apostrophe',Backquote:'grave',Comma:'comma',Period:'period',Slash:'slash'};
for(let i=0;i<26;i++)codeNames['Key'+String.fromCharCode(65+i)]=String.fromCharCode(97+i);
for(let i=0;i<10;i++)codeNames['Digit'+i]=String(i);
for(let i=1;i<=12;i++)codeNames['F'+i]='F'+i;
const winKeys={Space:32,Enter:13,Tab:9,Escape:27,Backspace:8,Delete:46,Insert:45,Home:36,End:35,PageUp:33,PageDown:34,ArrowLeft:37,ArrowRight:39,ArrowUp:38,ArrowDown:40,ShiftLeft:160,ShiftRight:161,ControlLeft:162,ControlRight:163,AltLeft:164,AltRight:165,MetaLeft:91,MetaRight:92,CapsLock:20,Minus:189,Equal:187,BracketLeft:219,BracketRight:221,Backslash:220,Semicolon:186,Quote:222,Backquote:192,Comma:188,Period:190,Slash:191};
for(let i=0;i<26;i++)winKeys['Key'+String.fromCharCode(65+i)]=65+i;
for(let i=0;i<10;i++)winKeys['Digit'+i]=48+i;
for(let i=1;i<=12;i++)winKeys['F'+i]=111+i;
const macKeys={KeyA:0,KeyS:1,KeyD:2,KeyF:3,KeyH:4,KeyG:5,KeyZ:6,KeyX:7,KeyC:8,KeyV:9,KeyB:11,KeyQ:12,KeyW:13,KeyE:14,KeyR:15,KeyY:16,KeyT:17,Digit1:18,Digit2:19,Digit3:20,Digit4:21,Digit6:22,Digit5:23,Equal:24,Digit9:25,Digit7:26,Minus:27,Digit8:28,Digit0:29,BracketRight:30,KeyO:31,KeyU:32,BracketLeft:33,KeyI:34,KeyP:35,Enter:36,KeyL:37,KeyJ:38,Quote:39,KeyK:40,Semicolon:41,Backslash:42,Comma:43,Slash:44,KeyN:45,KeyM:46,Period:47,Tab:48,Space:49,Backquote:50,Backspace:51,Escape:53,MetaRight:54,MetaLeft:55,ShiftLeft:56,CapsLock:57,AltLeft:58,ControlLeft:59,ShiftRight:60,AltRight:61,ControlRight:62,F1:122,F2:120,F3:99,F4:118,F5:96,F6:97,F7:98,F8:100,F9:101,F10:109,F11:103,F12:111,Home:115,PageUp:116,Delete:117,End:119,PageDown:121,ArrowLeft:123,ArrowRight:124,ArrowDown:125,ArrowUp:126};
function createInput(){
  let native,error=null;const scrollInput=createScrollAccumulator(process.platform);const heldKeys=new Set(),heldButtons=new Set();
  try{
    const k=require('koffi');
    if(process.platform==='win32'){
      const u=k.load('user32.dll'),move=u.func('bool __stdcall SetCursorPos(int x,int y)'),mouse=u.func('void __stdcall mouse_event(uint32_t flags,uint32_t dx,uint32_t dy,uint32_t data,uintptr_t extra)'),key=u.func('void __stdcall keybd_event(uint8_t vk,uint8_t scan,uint32_t flags,uintptr_t extra)');
      native={move:(x,y)=>move(x,y),button:(b,down)=>mouse([[2,4],[32,64],[8,16]][b][down?0:1],0,0,0,0),scroll:dy=>mouse(0x0800,0,0,(-dy)>>>0,0),key:(code,down)=>{const vk=winKeys[code];if(vk!==undefined)key(vk,0,(down?0:2)|(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Delete','Insert','Home','End','PageUp','PageDown','ControlRight','AltRight','MetaLeft','MetaRight'].includes(code)?1:0),0);}};
    }else if(process.platform==='linux'){
      if(process.env.XDG_SESSION_TYPE==='wayland')throw Error('Linux Wayland requires a desktop-portal remote-control session. Use an X11 desktop for remote control in this build.');
      const x=k.load('libX11.so.6'),t=k.load('libXtst.so.6'),open=x.func('void *XOpenDisplay(const char *)'),display=open(null);if(!display)throw Error('No X11 display is available');
      const sync=x.func('int XFlush(void *)'),symbol=x.func('unsigned long XStringToKeysym(const char *)'),keycode=x.func('unsigned int XKeysymToKeycode(void *,unsigned long)'),motion=t.func('int XTestFakeMotionEvent(void *,int,int,int,unsigned long)'),button=t.func('int XTestFakeButtonEvent(void *,unsigned int,int,unsigned long)'),key=t.func('int XTestFakeKeyEvent(void *,unsigned int,int,unsigned long)');
      native={move:(a,b)=>{motion(display,-1,a,b,0);sync(display);},button:(b,d)=>{button(display,[1,2,3][b],d?1:0,0);sync(display);},scroll:dy=>{const b=dy>0?5:4;for(let i=0;i<Math.abs(dy);i++){button(display,b,1,0);button(display,b,0,0);}sync(display);},key:(code,d)=>{const sym=codeNames[code];if(!sym)return;const n=keycode(display,symbol(sym));if(n)key(display,n,d?1:0,0);sync(display);}};
    }else if(process.platform==='darwin'){
      const cg=k.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics'),cf=k.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
      const point=k.struct('SIRemotePoint',{x:'double',y:'double'}),mouse=cg.func('void *CGEventCreateMouseEvent(void *,uint32_t,_CGPoint,int)'.replace('_CGPoint','SIRemotePoint')),key=cg.func('void *CGEventCreateKeyboardEvent(void *,uint16_t,bool)'),scroll=cg.func('void *CGEventCreateScrollWheelEvent(void *,uint32_t,uint32_t,...)'),post=cg.func('void CGEventPost(uint32_t,void *)'),release=cf.func('void CFRelease(void *)');let pos={x:0,y:0};
      const flags=cg.func('void CGEventSetFlags(void *,uint64_t)');
      const emit=e=>{if(e){let f=0;if([...heldKeys].some(c=>c.startsWith('Shift')))f|=1<<17;if([...heldKeys].some(c=>c.startsWith('Control')))f|=1<<18;if([...heldKeys].some(c=>c.startsWith('Alt')))f|=1<<19;if([...heldKeys].some(c=>c.startsWith('Meta')))f|=1<<20;flags(e,f);post(0,e);release(e);}};
      native={move:(x,y)=>{pos={x,y};emit(mouse(null,heldButtons.has(0)?6:heldButtons.has(2)?7:5,pos,heldButtons.has(2)?1:0));},button:(b,d)=>emit(mouse(null,[[1,2],[25,26],[3,4]][b][d?0:1],pos,[0,2,1][b])),scroll:dy=>emit(scroll(null,0,1,'int32_t',-dy)),key:(code,d)=>{if(macKeys[code]!==undefined)emit(key(null,macKeys[code],d));}};
    }else throw Error('Unsupported platform: '+os.platform());
  }catch(e){error=e.message;}
  return {
    status:()=>({available:!!native,error}),
    apply(event,bounds){
      if(!native||!event||typeof event!=='object')return;
      if(event.kind==='move'&&Number.isFinite(event.x)&&Number.isFinite(event.y))native.move(Math.round(bounds.x+Math.max(0,Math.min(1,event.x))*(bounds.width-1)),Math.round(bounds.y+Math.max(0,Math.min(1,event.y))*(bounds.height-1)));
      else if(event.kind==='button'&&[0,1,2].includes(event.button)&&typeof event.down==='boolean'){if(event.down)heldButtons.add(event.button);else heldButtons.delete(event.button);native.button(event.button,event.down);}
      else if(event.kind==='key'&&Object.hasOwn(codeNames,event.code)&&typeof event.down==='boolean'){if(event.down)heldKeys.add(event.code);else heldKeys.delete(event.code);native.key(event.code,event.down);}
      else if(event.kind==='scroll'){const delta=scrollInput.push(event.dy);if(delta)native.scroll(delta);}
    },
    release(){scrollInput.reset();if(native){for(const key of heldKeys)native.key(key,false);for(const b of heldButtons)native.button(b,false);}heldKeys.clear();heldButtons.clear();}
  };
}
module.exports={createInput,codeNames};
