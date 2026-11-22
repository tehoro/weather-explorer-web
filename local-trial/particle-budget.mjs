// Camera distance is in kilometres. Keep local detail, then progressively
// thin wide views; update and upload only the particles that will be drawn.
export function particleBudget(maximum,distance){
 const scale=Math.max(.1,Math.min(1,Math.pow(100/Math.max(100,distance),.85)));
 return Math.max(1,Math.round(maximum*scale));
}
export function updateParticleAttribute(attribute,count){
 attribute.clearUpdateRanges();
 if(count>0){attribute.addUpdateRange(0,count*attribute.itemSize);attribute.needsUpdate=true;}
}
