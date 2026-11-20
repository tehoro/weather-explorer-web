export const normal=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function coordinates(q){
 const m=q.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
 if(!m)return null;const lat=Number(m[1]),lon=Number(m[2]);
 return Math.abs(lat)<=89.85&&Math.abs(lon)<=180?['Selected coordinates',lat,lon,'','',0,[]]:null;
}
export function rank(rows,q){
 const parts=normal(q).split(',').map(s=>s.trim()),name=parts[0];
 const countries=new Intl.DisplayNames(['en'],{type:'region'});
 return rows.filter(r=>r[6].some(a=>a.startsWith(name))&&parts.slice(1).every(p=>normal(`${r[3]} ${countries.of(r[3])} ${r[4]}`).includes(p)))
 .sort((a,b)=>Number(b[6].includes(name))-Number(a[6].includes(name))||b[5]-a[5]).slice(0,8);
}
export function setupSearch(input,box,onChoose){
 let token=0,timer;const cache=new Map(),countries=new Intl.DisplayNames(['en'],{type:'region'});
 const close=()=>{box.replaceChildren();input.setAttribute('aria-expanded','false');};
 const note=text=>{const p=document.createElement('p');p.textContent=text;box.replaceChildren(p);input.setAttribute('aria-expanded','false');};
 async function search(){
  const id=++token,q=normal(input.value);close();if(q.length<2)return;
  let results;const coord=coordinates(q);
  if(coord)results=[coord];
  else if(/^[+\-\d.,\s]+$/.test(q)){note('Use latitude, longitude within −89.85…89.85 and −180…180.');return;}
  else{
   note('Finding places…');
   const key=[...q.split(',')[0].trim().slice(0,2)].map(c=>c.codePointAt(0).toString(16)).join('-');
   try{
    if(!cache.has(key)){const r=await fetch(`data/search/${key}.json`);if(!r.ok&&r.status!==404)throw Error();cache.set(key,r.status===404?[]:await r.json());}
    if(id!==token)return;results=rank(cache.get(key),q);
   }catch{if(id===token)note('Place search unavailable. Try again or enter latitude, longitude.');return;}
  }
  if(id!==token)return;close();
  for(const r of results){const b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.textContent=r[0]+(r[3]?` · ${countries.of(r[3])} · ${r[1].toFixed(2)}, ${r[2].toFixed(2)}`:` · ${r[1]}, ${r[2]}`);b.onclick=()=>{input.value=r[0];++token;close();onChoose(r[1],r[2],r[0]);};box.append(b);}
  input.setAttribute('aria-expanded',String(results.length>0));
  if(!results.length)note('No matching town. Try another spelling, or use coordinates for any location.');
 }
 input.oninput=()=>{++token;close();clearTimeout(timer);timer=setTimeout(search,180);};
 input.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();box.querySelector('button')?.focus();}if(e.key==='Escape'){++token;close();}if(e.key==='Enter'){e.preventDefault();const b=box.querySelector('button');if(b)b.click();else{clearTimeout(timer);search();}}};
 box.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();(e.key==='ArrowDown'?document.activeElement.nextElementSibling:document.activeElement.previousElementSibling)?.focus();}if(e.key==='Escape'){++token;close();input.focus();}};
}
