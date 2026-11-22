// The private trial uses two ports; Highlights' preferences live on the shell origin.
export function syncUnits(){
 if(location.origin!=='http://127.0.0.1:8092')return;
 const frame=document.createElement('iframe');frame.hidden=true;frame.src='http://127.0.0.1:8091/units-bridge.html';frame.title='Shared display units';
 addEventListener('message',e=>{
  if(e.origin!=='http://127.0.0.1:8091'||e.source!==frame.contentWindow||e.data?.type!=='local-units')return;
  for(const [k,v]of Object.entries(e.data.choices||{}))if(['temperature','wind','rain'].includes(k)&&(v==='auto'||Units.CHOICES[k].some(c=>c[0]===v)))Units.setChoice(k,v);
  dispatchEvent(new Event('local-units-change'));
 });document.body.append(frame);
}
