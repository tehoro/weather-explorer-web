import './assets/geotiff-2.1.3.js';
import {RasterReader} from './terrain-raster.mjs?v=20261122l';
import {colourTile,terrainGeometry} from './terrain-preparation.mjs?v=20261123c';
let reader;
onmessage=async({data:{id,method,args}})=>{
 try{
  let value;
  if(method==='init'){reader=new RasterReader(globalThis.GeoTIFF,'',new Set(args[0]));value=true;}
  else if(method==='grid')value=(await reader.grid(...args)).slice(); // Do not detach the disk-cache write's array.
  else if(method==='clear'){reader.files.clear();value=true;}
  else if(method==='colour')value=colourTile(...args);
  else if(method==='prepare'){const [p,a,ocean,mode]=args;value={...terrainGeometry(p,a,ocean),...colourTile({p,a,ocean},mode)};}
  else throw Error('Unknown terrain job');
  const buffers=value instanceof Float32Array?[value.buffer]:Object.values(value||{}).filter(ArrayBuffer.isView).map(a=>a.buffer);
  postMessage({id,value,hits:reader.saved.hits},[...new Set(buffers)]);
 }catch(e){postMessage({id,error:e.message});}
};
