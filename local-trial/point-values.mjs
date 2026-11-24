// Bounds apply to displayed point values; source forecast arrays stay unchanged.
export function displayPoint(row){
 const out={...row},speed=Math.hypot(row.u,row.v);
 if(Number.isFinite(out.gust)&&Number.isFinite(speed))out.gust=Math.max(speed,out.gust);
 if(Number.isFinite(out.dewpoint)&&Number.isFinite(out.temperature))out.dewpoint=Math.min(out.temperature,out.dewpoint);
 return out;
}
export function snapForecast(fraction,count){return Math.max(0,Math.min(count-1,Math.round(fraction*count-1)));}

export function windReadout(u,v,gust,units,direction){
 const speed=Math.round(units.convert(Math.hypot(u,v),'m/s'));
 return 'Wind: '+direction+' '+speed+(Number.isFinite(gust)?' g '+Math.round(units.convert(Math.max(gust,Math.hypot(u,v)),'m/s')):'')+' '+units.unit('m/s');
}

export function pointElevation(metres,units){
 if(!Number.isFinite(metres))return 'Unavailable';
 const feet=units.unit('m/s')==='mph';
 return Math.round(feet?metres/0.3048:metres).toLocaleString()+' '+(feet?'ft':'m');
}
