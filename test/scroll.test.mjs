import {test} from 'node:test';
import assert from 'node:assert/strict';
import latency from '../app/latency.js';

test('wheel pixel, line and page distances normalize to bounded pixel input',()=>{
 assert.equal(latency.wheelPixels(3),3);
 assert.equal(latency.wheelPixels(3,1),48);
 assert.equal(latency.wheelPixels(-1,2,600),-100);
 assert.equal(latency.wheelPixels(10000),100);
 assert.equal(latency.wheelPixels(NaN),0);
 assert.equal(latency.wheelPixels(3,9),0);
});
test('Windows preserves small trackpad distances instead of emitting a full notch each time',()=>{
 const s=latency.createScrollAccumulator('win32');
 assert.equal(Array.from({length:100},()=>s.push(1)).reduce((a,b)=>a+b,0),120);
 s.reset();assert.equal(s.push(-100),-120);
});
test('Linux accumulates small movements into wheel steps and preserves direction',()=>{
 const s=latency.createScrollAccumulator('linux');
 for(let i=0;i<9;i++)assert.equal(s.push(10),0);
 assert.equal(s.push(10),1);assert.equal(s.push(-100),-1);
});
test('Mac preserves fractional pixel distances without converting pixels into lines',()=>{
 const s=latency.createScrollAccumulator('darwin');
 assert.deepEqual([s.push(.25),s.push(.25),s.push(.25),s.push(.25)],[0,0,0,1]);
 assert.equal(s.push(-30),-30);
});
test('scroll residue is cleared after disconnect or a pause between gestures',()=>{
 let time=0;const s=latency.createScrollAccumulator('linux',{now:()=>time});
 assert.equal(s.push(90),0);s.reset();assert.equal(s.push(10),0);
 time=300;assert.equal(s.push(90),0);assert.equal(s.push(10),1);
});
test('invalid or enormous remote scroll values cannot create a large native jump',()=>{
 for(const platform of ['win32','linux','darwin']){
  const s=latency.createScrollAccumulator(platform);
  for(const value of [NaN,Infinity,undefined,'10',0])assert.equal(s.push(value),0);
  assert.ok(Math.abs(s.push(1e9))<=120);
 }
});
