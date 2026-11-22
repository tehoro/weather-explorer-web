import {TYPES,precipitationType,typeName} from './precipitation-type.mjs?v=20261122an';
export const chartLayout={width:880,left:52,span:810};
export const compassDirection=(u,v)=>['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round((Math.atan2(-u,-v)*180/Math.PI+360)/22.5)%16];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const niceStep=range=>{const raw=Math.max(range,.1)/4,p=10**Math.floor(Math.log10(raw));return [1,2,5,10].find(v=>v*p>=raw)*p;};
// Approximate solar time and declination suffice for contextual night shading.
function night(ms,lat,lon){
 const d=new Date(ms),day=(ms-Date.UTC(d.getUTCFullYear(),0,1))/86400000,rad=Math.PI/180;
 const declination=23.44*rad*Math.sin(2*Math.PI*(day-80)/365.2425),hour=(d.getUTCHours()+d.getUTCMinutes()/60+lon/15-12)*15*rad;
 return Math.sin(lat*rad)*Math.sin(declination)+Math.cos(lat*rad)*Math.cos(declination)*Math.cos(hour)<0;
}
export function meteogram({times,rows,zone,location,frame,units,height=174}){
 const bottom=height-30;
 const n=times.length,x=i=>52+(i+1)/n*810,start=Date.parse(times[0])-10800000,end=Date.parse(times.at(-1)),tx=ms=>52+(ms-start)/(end-start)*810;
 const minuteFmt=new Intl.DateTimeFormat('en-GB',{timeZone:zone,minute:'2-digit'});
 const hourFmt=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}),dayFmt=new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'short',day:'numeric',month:'short'}),dateFmt=new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'medium',timeStyle:'short'});
 const available=k=>[...rows.values()].some(r=>Number.isFinite(r[k]));
 const specs=[
  {title:'Temperature (green) / dew point (orange)',unit:'°C',series:[['Temperature',r=>r.temperature,'#39c5a1'],...(available('dewpoint')?[['Dew point',r=>r.dewpoint,'#f18b43']]:[])]},
  {title:'Precipitation · preceding 3 hours'+([...rows.values()].some(r=>r.snow>0)?' · water equivalent':''),unit:'mm',rain:true,series:[['Total',r=>r.rain*3,TYPES[1][1]],...([...rows.values()].some(r=>r.snow>0)?[['Snow water (included)',r=>r.snow>0?r.snow*3:NaN,TYPES[5][1]]]:[])]},
  {title:'Wind (gold) / gust (salmon) · arrows show flow (N ↑)',unit:'m/s',wind:true,series:[['Wind',r=>Math.hypot(r.u,r.v),'#f1c56c'],...(available('gust')?[['Gust',r=>r.gust,'#f69980']]:[])]},
  ...(available('totalCloud')?[{title:'Total cloud',unit:'%',cloud:true,series:[['Cloud',r=>r.totalCloud*100,'#c6d9ee']]}]:[])];
 return specs.map(panel=>{
  const plotTop=panel.wind?32:22;
  const vals=[...rows.values()].flatMap(r=>panel.series.map(([,get])=>units.convert(get(r),panel.unit))).filter(Number.isFinite);
  const step=panel.cloud?25:niceStep(Math.max(...vals,1)-Math.min(...vals,0)),lo=panel.unit==='°C'?Math.floor(Math.min(...vals,0)/step)*step:0,hi=panel.cloud?100:Math.max(lo+step,Math.ceil(Math.max(...vals,1)/step)*step),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-plotTop);
  let svg=`<svg viewBox="0 0 880 ${height}" role="img" aria-label="${escape(panel.title)}"><text x="52" y="12" fill="#e6f2f7" font-size="12">${escape(panel.title+' · '+units.unit(panel.unit))}</text>`;
  let nightStart=null;
  for(let ms=start;ms<=end;ms+=1800000){const dark=ms<end&&night(ms+900000,location.lat,location.lon);if(dark&&nightStart===null)nightStart=ms;if(!dark&&nightStart!==null){svg+=`<rect x="${tx(nightStart)}" y="${plotTop}" width="${tx(ms)-tx(nightStart)}" height="${bottom-plotTop}" fill="#c2cad4" opacity=".10"/>`;nightStart=null;}}
  for(let v=lo;v<=hi+step*.001;v+=step)svg+=`<path d="M52 ${y(v)}H862" stroke="#a6bdd5" opacity=".2"/><text x="46" y="${y(v)+4}" text-anchor="end" fill="#a8bccb" font-size="10">${Number(v.toFixed(2))}</text>`;
  // Scan half-hour boundaries too: local offsets need not be whole hours.
  let dayStart=start,previousDay=dayFmt.format(start);
  for(let ms=Math.ceil(start/1800000)*1800000;ms<=end;ms+=1800000){
   const date=new Date(ms),hour=Number(hourFmt.format(date)),minute=Number(minuteFmt.format(date));
   if(minute===0&&hour%6===0)svg+=`<path d="M${tx(ms)} ${plotTop}V${bottom+5}" stroke="#adc1ce" opacity="${hour===0?.45:.15}"/><text x="${tx(ms)}" y="${height-17}" text-anchor="middle" fill="#a9c5d4" font-size="10">${String(hour).padStart(2,'0')}</text>`;
   const day=dayFmt.format(date);
   if(day!==previousDay){if(ms-dayStart>10800000)svg+=`<text x="${tx((dayStart+ms)/2)}" y="${height-3}" text-anchor="middle" fill="#d4e4ee" font-size="11">${previousDay}</text>`;dayStart=ms;previousDay=day;}
  }
  if(end-dayStart>10800000)svg+=`<text x="${tx((dayStart+end)/2)}" y="${height-3}" text-anchor="middle" fill="#d4e4ee" font-size="11">${previousDay}</text>`;
  for(const [name,get,colour]of panel.series){
   let path='',pen=false;
   for(let i=0;i<n;i++){
    const r=rows.get(i),value=r?units.convert(get(r),panel.unit):NaN;if(!Number.isFinite(value)){pen=false;continue;}
    const tip=escape(name+': '+units.format(get(r),panel.unit)+' · '+dateFmt.format(new Date(times[i]))+(panel.rain?' · preceding 3 hours · '+typeName(r.ptype,r.rain,r.snow):''));
    if(panel.rain){const total=name==='Total',width=810/n,fill=total?TYPES[precipitationType(r.ptype,r.rain,r.snow)][1]:colour;
     svg+=`<rect x="${x(i)-width+width*(total?.06:.78)}" y="${y(value)}" width="${width*(total?.64:.18)}" height="${Math.max(0,bottom-y(value))}" fill="${fill}"><title>${tip}</title></rect>`;
    }else{path+=(pen?'L':'M')+x(i)+','+y(value)+' ';pen=true;svg+=`<circle cx="${x(i)}" cy="${y(value)}" r="2" fill="${colour}"><title>${tip}</title></circle>`;}
   }
   if(!panel.rain)svg+=`<path d="${path}" fill="none" stroke="${colour}" stroke-width="2" pointer-events="none"/>`;
  }
  if(panel.wind)for(let i=0;i<n;i++){const r=rows.get(i);if(!r||Math.hypot(r.u,r.v)<.3)continue;svg+=`<g transform="translate(${x(i)},24) rotate(${Math.atan2(r.u,r.v)*180/Math.PI})"><title>Wind from ${compassDirection(r.u,r.v)}</title><path d="M0 5V-5M-3 -1L0 -5L3 -1" fill="none" stroke="#e8dcad" stroke-width="1.4"/></g>`;}
  return svg+`<line class="timeCursor" x1="${x(frame)}" x2="${x(frame)}" y1="${plotTop}" y2="${bottom+5}" stroke="#ff4545" stroke-width="1.5"/></svg>`;
 }).join('');
}
