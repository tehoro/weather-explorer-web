import assert from 'node:assert/strict';
import {drawVideoBands} from './video-recording.mjs';
for(const [w,h] of [[1920,1080],[1280,642],[720,1280],[1080,1080]]){
 const calls=[];const ctx={save(){},restore(){},fillRect(){},fillText(text,x,y,max){calls.push({text,x,y,max});}};
 drawVideoBands(ctx,w,h,{title:'Dublin · Weather Explorer',description:'10 m wind · Precipitation · Clouds',date:'23 Nov 2026',hour:'Mon 3:00 PM',zone:'GMT · Europe/Dublin',lead:'T+21',run:'Model run: 2026-11-22 18:00 UTC'});
 for(const c of calls){assert(c.x>0&&c.y>0&&c.y<h);assert(c.max<=w-2*c.x);}
 assert(calls.some(c=>c.text.includes('weatherexplorer.neilgordon.me')));
 assert(calls.some(c=>c.text.includes('CC BY 4.0')));
 assert(calls.some(c=>c.text.includes('23 Nov 2026')&&c.y>h/2));
}
console.log('Video title, forecast footer, website and attribution fit all tested aspect ratios.');

const timestamps=[];const ctx={save(){},restore(){},fillRect(){},fillText(text){if(text.includes('NZDT'))timestamps.push({text,font:this.font});}};
for(const hour of ['Wed 3:11 PM','Wed 3:29 PM','Wed 9:59 PM','Wed 10:00 PM'])drawVideoBands(ctx,1920,1080,{title:'Test',description:'Clouds',date:'25 Nov 2026',hour,zone:'NZDT · Pacific/Auckland',lead:'T+38',run:''});
assert(timestamps.every(t=>t.font.includes('monospace')));
assert.equal(new Set(timestamps.map(t=>t.text.length)).size,1);
console.log('Video timestamp has fixed-width digits and a reserved two-column hour.');
