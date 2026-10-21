import {test} from 'node:test';
import assert from 'node:assert/strict';
import latency from '../app/latency.js';
const base={maxBitrate:2000000,maxFramerate:30,scaleResolutionDownBy:1.5};
const track={getSettings:()=>({width:3840,height:2160})};
test('manual resolution and bitrate survive adaptive profile updates',()=>{
 const choice={height:720,bitrate:8000000};
 assert.deepEqual(latency.qualityProfile(base,choice,track),{maxBitrate:8000000,maxFramerate:30,scaleResolutionDownBy:3});
 assert.equal(latency.qualityProfile({...base,maxBitrate:450000,scaleResolutionDownBy:4},choice,track).scaleResolutionDownBy,3);
 assert.deepEqual(base,{maxBitrate:2000000,maxFramerate:30,scaleResolutionDownBy:1.5});
});
test('Auto restores adaptation independently for each selector',()=>{
 assert.deepEqual(latency.qualityProfile(base,{height:0,bitrate:0},track),base);
 assert.equal(latency.qualityProfile(base,{height:1080,bitrate:0},track).maxBitrate,2000000);
 assert.equal(latency.qualityProfile(base,{height:0,bitrate:4000000},track).scaleResolutionDownBy,1.5);
});
test('resolution preserves aspect ratio without upscaling and rejects invalid choices',()=>{
 assert.equal(latency.qualityProfile(base,{height:2160,bitrate:0},{getSettings:()=>({width:1280,height:720})}).scaleResolutionDownBy,1);
 assert.equal(latency.qualityProfile(base,{height:1080,bitrate:0},{getSettings:()=>({width:3440,height:1440})}).scaleResolutionDownBy,3440/1920);
 for(const choice of [{height:NaN,bitrate:0},{height:720,bitrate:Infinity},{height:720,bitrate:99}])assert.deepEqual(latency.qualityProfile(base,choice,track),base);
});
