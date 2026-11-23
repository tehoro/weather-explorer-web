// Only visible labels request detailed tiles; use the point forecast's sampler.
export function temperatureText(name,a,b,t,units){
 if(!Number.isFinite(a)||!Number.isFinite(b))return name;
 return name+' '+Math.round(units.convert(a+(b-a)*t,'°C'))+'°';
}
export class PlaceTemperatures{
 constructor(weather,labels,centre){this.weather=weather;this.labels=labels;this.centre=centre;this.cache=new Map();this.active=0;this.elapsed=0;}
 tick(dt){
  this.elapsed+=dt;if(this.elapsed<.25)return;this.elapsed=0;
  const w=this.weather,data=w.data;if(!data.meta)return;
  if(this.data!==data){this.data=data;this.cache.clear();}
  const f=w.displayFrame??w.frame,a=Math.floor(f),t=f-a,b=t?Math.min(a+1,data.meta.times.length-1):a;
  const enabled=document.getElementById('placeTemperatures').checked;
  const rows=this.labels.visible.map(p=>({...p,element:p.element}));
  const centre=this.centre();if(centre)rows.push(centre);
  for(const p of rows){
   let text=p.name;
   if(enabled){
    const values=[a,b].map(frame=>{
     const key=[data.meta.run,frame,p.lat,p.lon].join('/');let entry=this.cache.get(key);
     if(!entry&&this.active<4){
      entry={value:null};this.cache.set(key,entry);this.active++;
      data.temperature(frame,p.lat,p.lon).then(value=>{entry.value=value;}).catch(()=>{entry.failed=Date.now();}).finally(()=>this.active--);
     }
     if(entry?.failed&&Date.now()-entry.failed>30000)this.cache.delete(key);
     return entry?.value;
    });
    text=temperatureText(p.name,...values,t,Units);
   }
   if(p.element.textContent!==text)p.element.textContent=text;
  }
  while(this.cache.size>512)this.cache.delete(this.cache.keys().next().value);
 }
}
