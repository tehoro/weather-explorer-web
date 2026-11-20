// Exercise the actual worker: cloud fraction controls opacity without an RH profile.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context=vm.createContext({self:{},Float32Array,Uint8Array,Math});
vm.runInContext(readFileSync(new URL('./assets/hour-worker.js',import.meta.url),'utf8'),context);
const data={grid:{nx:2,ny:2,valid:[1,1,1,1]},terrain:[0,0,0,0],layers:[],cloud_cover:{lcc:[0,.25,.5,1],mcc:[0,0,0,0],hcc:[0,0,0,0]}};
const result=context.pack(data,'cover',121),y=10;
const opacity=i=>result.voxels[((Math.floor(i/2)*121+y)*2+i%2)*4+1];
assert.deepEqual([0,1,2,3].map(opacity),[0,64,128,255]);
assert.equal(result.voxels[((0*121+70)*2)*4+1],0,'No invented middle cloud');
assert.equal(result.top,12000);
console.log('Cloud-cover worker: zero, partial and full cover preserve their fractions.');
