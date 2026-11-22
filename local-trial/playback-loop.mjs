export function replayFrame(times,now=Date.now()){
 if(!times?.length)return 0;
 let best=0;
 for(let i=1;i<times.length;i++)if(Math.abs(Date.parse(times[i])-now)<Math.abs(Date.parse(times[best])-now))best=i;
 return best;
}
