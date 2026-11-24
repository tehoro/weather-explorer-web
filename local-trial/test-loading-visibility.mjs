import test from 'node:test';
import assert from 'node:assert/strict';
import {setLoadingVisible} from './loading-visibility.mjs';
test('short refinements stay hidden; continuous loading appears once after one second',()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=new Map();let now=0,id=0;
 globalThis.setTimeout=(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;};
 globalThis.clearTimeout=id=>timers.delete(id);
 const tick=ms=>{now+=ms;for(const [id,timer]of timers)if(timer.at<=now){timers.delete(id);timer.fn();}};
 try{const label={hidden:true};
 setLoadingVisible(label,true);tick(500);setLoadingVisible(label,false);
 tick(1000);assert.equal(label.hidden,true);
 setLoadingVisible(label,true);tick(700);setLoadingVisible(label,true);
 tick(299);assert.equal(label.hidden,true);
 tick(1);assert.equal(label.hidden,false);
 setLoadingVisible(label,true);assert.equal(label.hidden,false);
 setLoadingVisible(label,false);assert.equal(label.hidden,true);
 setLoadingVisible(label,true);tick(999);assert.equal(label.hidden,true);
 tick(1);assert.equal(label.hidden,false);
 }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
