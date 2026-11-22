// Time-based bearing: independent of display refresh rate and forecast playback.
export function orbitStep(bearing,seconds,period=120){return (bearing+Math.max(0,seconds)*Math.PI*2/period)%(Math.PI*2);}
export function orbitOffset(radius,height,bearing){return {x:radius*Math.sin(bearing),y:height,z:radius*Math.cos(bearing)};}
