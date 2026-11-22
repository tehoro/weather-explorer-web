// Protect the displayed time and its two neighbours, then fill the future.
export function forecastOrder(frame,count){
 frame=Math.max(0,Math.min(count-1,frame));
 return [...new Set([frame,frame-1,...Array.from({length:count-frame-1},(_,i)=>frame+i+1),...Array.from({length:Math.max(0,frame-1)},(_,i)=>i)].filter(i=>i>=0&&i<count))];
}
