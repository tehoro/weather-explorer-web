// Versioned, self-contained view links. Only recognised controls are restored.
export const shareControls=['placeTemperatures','windLayer','rainLayer','cloudLow','cloudMiddle','cloudHigh','pressureLayer','surfaceCover','cloudOpacity','surfaceField','surfaceStyle','placeNames','precipitationStyle','terrainScale','windDensity','windSpeed','orbitPeriod','playbackSpeed'];
export function readView(hash){
 try{
  const s=JSON.parse(new URLSearchParams(hash.replace(/^#/, '')).get('view'));
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<20000);
  if(s?.v!==1||!vector(s.eye)||!vector(s.target)||!Number.isFinite(s.anchor?.lat)||Math.abs(s.anchor.lat)>89.85||!Number.isFinite(s.anchor.lon))return null;
  return s;
 }catch{return null;}
}
export function captureControls(doc){return Object.fromEntries(shareControls.map(id=>{const e=doc.getElementById(id);return [id,e.type==='checkbox'?e.checked:e.value];}));}
export function restoreControls(doc,values={}){
 if(!values||typeof values!=='object')return;
 for(const id of shareControls){
  const e=doc.getElementById(id),v=values[id];if(v===undefined)continue;
  if(e.type==='checkbox'){if(typeof v==='boolean')e.checked=v;}
  else if(e.tagName==='SELECT'){if([...e.options].some(o=>o.value===v))e.value=v;}
  else if(Number.isFinite(Number(v))){e.value=String(Math.max(Number(e.min),Math.min(Number(e.max),Number(v))));}
 }
 const terrain=doc.getElementById('terrainScale');
 doc.getElementById('terrainScaleValue').textContent=Number(terrain.value).toFixed(1)+'×';
}
export function viewURL(href,state,time){
 const url=new URL(href);url.search='';url.searchParams.set('lat',state.anchor.lat);url.searchParams.set('lon',state.anchor.lon);
 if(time)url.searchParams.set('time',time);
 url.hash=new URLSearchParams({view:JSON.stringify({...state,v:1})}).toString();return url.href;
}
