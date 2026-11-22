import {WeatherData} from './weather-engine.mjs?v=20261122at';
const data=new WeatherData();let regionKey='';
onmessage=async({data:message})=>{
 const {id,method,args}=message;
 if(method==='priority'){if(data.meta)data.prioritise(args[0]);return;}
 if(method==='region'){regionKey=args[0];return;}
 try{
  let value;
  if(method==='init'){
   value=await data.init(args[0]);
   const requested=value.steps.indexOf(args[1]?.step),time=args[1]?.time||Date.now(),first=requested>=0?requested:value.times.reduce((best,t,i)=>Math.abs(Date.parse(t)-time)<Math.abs(Date.parse(value.times[best])-time)?i:best,0);
   void data.preload((ready,total)=>postMessage({progress:{ready,total}}),first).catch(()=>postMessage({progress:{error:true}}));
  }else if(method==='point'){value=await data.point(...args);
  }else if(method==='stats'){await data.disk.writes;value={diskHits:data.disk.hits,globalFrames:data.global.size};
  }else if(method==='fine'){
   const [frame,region,n,key]=args;value=await data.grid(frame,region,n,()=>regionKey===key);
   if(regionKey!==key)throw Error('Superseded weather view');
  }else value=await data.coarseGrid(...args);
  postMessage({id,value},value?.fields&&!Array.isArray(value.fields)?Object.values(value.fields).map(a=>a.buffer):[]);
 }catch(e){postMessage({id,error:e.message});}
};
