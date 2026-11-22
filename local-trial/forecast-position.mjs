// Preserve intermediate forecast times when moving between Local and globe.
export function frameAtTime(times,time){
 const values=times.map(t=>typeof t==='number'?t:Date.parse(t));
 if(time<=values[0])return 0;
 for(let i=1;i<values.length;i++)if(time<=values[i])return i-1+(time-values[i-1])/(values[i]-values[i-1]);
 return values.length-1;
}
export function timeAtFrame(times,frame){const a=Math.floor(frame),b=Math.min(times.length-1,a+1),value=t=>typeof t==='number'?t:Date.parse(t);return value(times[a])+(value(times[b])-value(times[a]))*(frame-a);}
