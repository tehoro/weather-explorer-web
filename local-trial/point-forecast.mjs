import {meteogram,compassDirection,chartLayout} from './meteogram.mjs?v=20261123c';
import {displayPoint,snapForecast,windReadout} from './point-values.mjs';
import {displayZone,timeParts,forecastMoment} from './local-time.mjs';
import {typeName,typeColour,typeLegend} from './precipitation-type.mjs?v=20261123c';
import {syncUnits} from './shared-units.mjs';
export class PointForecast{
 constructor(weather,fly){
  this.weather=weather;this.fly=fly;this.token=0;this.rows=new Map();this.panel=document.createElement('section');this.panel.id='pointForecast';this.panel.className='glass';this.panel.hidden=true;
  this.panel.innerHTML='<div class="panelHeading"><h2 id="pointTitle">Point forecast</h2><button id="pointClose" aria-label="Close point forecast">×</button></div><div id="pointCoordinates"></div><div id="pointTime"></div><div id="pointTotal"></div><div id="pointValues"></div><div class="pointActions"><button id="pointFly">Centre here</button><button id="pointExpand" aria-expanded="false">Show meteogram</button></div><div id="pointChart" hidden></div><p id="pointStatus"></p>';
  document.body.append(this.panel);const $=id=>this.panel.querySelector('#'+id);
  $('pointClose').onclick=()=>{this.token++;this.location=null;this.panel.hidden=true;$('pointChart').hidden=true;this.panel.classList.remove('expanded');$('pointExpand').textContent='Show meteogram';$('pointExpand').setAttribute('aria-expanded','false');this.panel.style.width='';this.panel.style.height='';this.panel.style.top='';document.getElementById('pointHint').hidden=false;dispatchEvent(new Event('point-selection-change'));};
  $('pointFly').onclick=()=>this.fly(this.location);
  $('pointExpand').onclick=()=>{const open=$('pointChart').hidden;$('pointChart').hidden=!open;this.panel.classList.toggle('expanded',open);$('pointExpand').textContent=open?'Hide meteogram':'Show meteogram';$('pointExpand').setAttribute('aria-expanded',String(open));if(open){this.panel.style.top=innerWidth<=700?'94px':'70px';}else{this.panel.style.width='';this.panel.style.height='';}this.chart();};
  $('pointChart').onclick=e=>{const svg=e.target.closest('svg');if(!svg)return;const b=svg.getBoundingClientRect(),f=Math.max(0,Math.min(1,((e.clientX-b.left)/b.width*chartLayout.width-chartLayout.left)/chartLayout.span));const w=this.weather;w.heldFrame=null;w.playing=false;w.elapsed=0;w.endHold=0;w.playLabel();const bar=e.target.closest('[data-forecast-frame]');w.load(bar?Number(bar.dataset.forecastFrame):snapForecast(f,w.data.meta.times.length));};
  const heading=this.panel.querySelector('.panelHeading');let drag=null;
  heading.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const b=this.panel.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:b.left,top:b.top};heading.setPointerCapture(e.pointerId);e.preventDefault();});
  heading.addEventListener('pointermove',e=>{if(!drag)return;const b=this.panel.getBoundingClientRect();this.panel.style.left=Math.max(0,Math.min(innerWidth-b.width,drag.left+e.clientX-drag.x))+'px';this.panel.style.top=Math.max(0,Math.min(innerHeight-b.height,drag.top+e.clientY-drag.y))+'px';});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])heading.addEventListener(event,()=>{drag=null;});
  this.chartResize=new ResizeObserver(()=>{if(!this.panel.hidden&&this.panel.classList.contains('expanded'))this.chart();});this.chartResize.observe($('pointChart'));
  addEventListener('local-units-change',()=>{this.key=null;this.update();this.chart();});syncUnits();
 }
 select(lat,lon,name){
  this.location={lat,lon,name:name||'Selected point'};this.panel.hidden=false;document.getElementById('pointHint').hidden=true;
  this.panel.querySelector('#pointTitle').textContent=this.location.name;this.panel.querySelector('#pointCoordinates').textContent=Math.abs(lat).toFixed(3)+'°'+(lat<0?'S':'N')+', '+Math.abs(lon).toFixed(3)+'°'+(lon<0?'W':'E');this.load();dispatchEvent(new Event('point-selection-change'));
 }
 async load(){
  const w=this.weather;if(!w.data.meta)return;
  const token=++this.token,data=w.data,location=this.location;this.data=data;this.rows.clear();this.key=null;this.update();this.chart();
  const current=Math.round(w.displayFrame??w.frame),order=[...new Set([current,current+1,current-1,...data.meta.times.map((_,i)=>i)])].filter(i=>i>=0&&i<data.meta.times.length);
  try{
   for(const f of order){if(token!==this.token)return;const row=await data.point(f,location.lat,location.lon);if(token!==this.token)return;this.rows.set(f,displayPoint(row));this.key=null;this.update();this.chart();}
  }catch(e){if(token===this.token)this.panel.querySelector('#pointStatus').textContent='Point forecast incomplete. Select the point again to retry.';}
 }
 update(){
  if(!this.location)return;const w=this.weather;if(!w.data.meta)return;
  const centre=w.context().centre,dlon=((centre.lon-this.location.lon+540)%360)-180;
  this.panel.querySelector('#pointFly').hidden=Math.abs(centre.lat-this.location.lat)<.0001&&Math.abs(dlon)<.0001;
  if(this.data!==w.data){void this.load();return;}
  const frame=w.displayFrame??w.frame,a=Math.floor(frame),b=Math.min(a+1,w.data.meta.times.length-1),t=frame-a,zone=displayZone(this.location.lat,this.location.lon),moment=forecastMoment(w.data.meta,frame);
  const key=[Math.floor(moment.time/60000),this.rows.size,Units.choice('temperature'),Units.choice('wind'),Units.choice('rain'),zone].join('/');
  if(key===this.key)return;this.key=key;
  this.panel.querySelector('#pointTime').textContent=timeParts(moment.time,zone).full+(zone==='UTC'?'':' · '+zone);
  this.panel.querySelector('#pointTotal').textContent=this.rows.size===w.data.meta.times.length?'Total precipitation: '+Units.format([...this.rows.values()].reduce((sum,r)=>sum+r.rain*3,0),'mm')+' · full '+(w.data.meta.times.length*3)+'-hour period'+([...this.rows.values()].some(r=>r.snow>0)?' (including snow water equivalent)':''):'';
  const A=this.rows.get(a),B=t?this.rows.get(b):A,el=this.panel.querySelector('#pointValues');
  if(!A||!B){el.textContent='Loading weather at this point…';return;}
  const v=k=>A[k]*(1-t)+B[k]*t,u=v('u'),north=v('v');
  const kind=typeName(t<.5?A.ptype:B.ptype,v('rain'),v('snow'));
  el.textContent=Units.format(v('temperature'),'°C')+(Number.isFinite(v('dewpoint'))?' · Dew point '+Units.format(v('dewpoint'),'°C'):'')+'\n'+windReadout(u,north,v('gust'),Units,compassDirection(u,north))+'\n'+kind+' · '+Units.format(v('rain'),'mm/h')+' total'+(v('snow')>0?' · '+Units.format(v('snow'),'mm/h')+' snow water equivalent':'')+'\nPressure '+Units.format(v('pressure'),'hPa')+' · '+(Number.isFinite(v('totalCloud'))?'Total cloud '+Math.round(v('totalCloud')*100)+'%':'Cloud low / middle / high '+['low','middle','high'].map(k=>Math.round(v(k)*100)+'%').join(' / '));
  if(kind!=='Dry'){const lines=el.textContent.split('\n'),swatch=document.createElement('span');swatch.textContent='■ ';swatch.style.color=typeColour(t<.5?A.ptype:B.ptype,v('rain'),v('snow'));swatch.setAttribute('aria-hidden','true');el.replaceChildren(document.createTextNode(lines.slice(0,2).join('\n')+'\n'),swatch,document.createTextNode(lines.slice(2).join('\n')));}
  this.panel.querySelector('#pointStatus').textContent=this.rows.size+'/'+w.data.meta.times.length+' three-hourly times · IFS model values; terrain does not downscale this forecast.';
  this.panel.querySelectorAll('.timeCursor').forEach(line=>{line.setAttribute('x1',chartLayout.left+(frame+1)/w.data.meta.times.length*chartLayout.span);line.setAttribute('x2',chartLayout.left+(frame+1)/w.data.meta.times.length*chartLayout.span);});
 }
 chart(){
  const host=this.panel.querySelector('#pointChart');if(host.hidden||!this.location||!this.data?.meta)return;
  const times=this.data.meta.times,zone=displayZone(this.location.lat,this.location.lon);
  const periods=[...new Set((this.data.meta.point_fields?.gust_period_hours||[]).filter(Number.isFinite))],gustNote=periods.length===1?'Gusts are maxima in the preceding '+periods[0]+' '+(periods[0]===1?'hour':'hours')+'.':'Gusts use the model accumulation period at each time.';
  const box=host.getBoundingClientRect(),height=Math.max(100,(box.height-70)/4*880/Math.max(1,box.width));
  host.innerHTML=meteogram({height,times,rows:this.rows,zone,location:this.location,frame:this.weather.displayFrame??this.weather.frame,units:Units})+'<p class="precipitationKey"><small>'+typeLegend()+'</small></p><p title="Three-hourly spot values joined by straight lines. Click a chart to select a forecast time. Precipitation bars cover the preceding 3 hours; colours show precipitation type. '+([...this.rows.values()].some(r=>r.snow>0)?'Pale lavender bars alongside show snow water equivalent, already included in the total. ':'')+gustNote+' Grey shading shows approximate night-time.">3-hourly values · precipitation: previous 3 h · click a chart to change time. '+gustNote+'</p>';
 }
}
