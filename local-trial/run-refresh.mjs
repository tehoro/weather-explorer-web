import {WeatherData} from './weather-data.mjs?v=20261122e';
export const nearestTime=(times,time)=>times.reduce((best,t,i)=>Math.abs(Date.parse(t)-time)<Math.abs(Date.parse(times[best])-time)?i:best,0);
const runLabel=run=>`${run.slice(0,4)}-${run.slice(4,6)}-${run.slice(6,8)} ${run.slice(8)}:00 UTC`;
// Stage a separate data source. Neither the displayed run nor its playback is
// changed until every time for the current geographic footprint is available.
export class RunRefresh{
 constructor({active,view,apply,report,create=()=>new WeatherData()}){Object.assign(this,{active,view,apply,report,create});}
 async check(){
  if(this.busy||!this.active().meta||!this.view())return;this.busy=true;
  try{
   const active=this.active(),latest=await active.json('/global-data/latest.json');
   if(latest.run<=active.meta.run){
    const s=await active.json('/global-data/refresh-status.json').catch(()=>null);
    if(s&&['preparing','pressure','validating'].includes(s.state))this.report(`Preparing global forecast · ${runLabel(s.run)}${s.total?` · ${s.completed}/${s.total} times`:''}. Current weather keeps animating.`);
    else if(s?.state==='error')this.report('Forecast refresh delayed. Keeping the current run; checking again automatically.');
    else this.report('');return;
   }
   if(this.candidate?.meta.run!==latest.run){const data=this.create();await data.init(latest);this.candidate=data;this.staged=null;}
   const data=this.candidate,view=this.view(),key=view.key;
   const valid=()=>this.view()?.key===key&&this.active()===active;
   const grids=this.staged?.key===key?this.staged.grids:new Map();this.staged={key,grids};
   const first=nearestTime(data.meta.times,view.time);
   for(let i=0;i<data.meta.times.length;i++){
    if(!valid())return;const f=(first+i)%data.meta.times.length;
    this.report(`Loading newer forecast · ${runLabel(data.meta.run)} · ${grids.size}/${data.meta.times.length}. Current weather keeps animating.`);
    if(!grids.has(f))grids.set(f,await data.grid(f,view.region,129,valid));
   }
   if(!valid())return;
   await this.apply(data,grids,key);this.candidate=null;this.staged=null;this.report('');
  }catch(e){this.report('New forecast is not ready for this view yet. Keeping the current weather and retrying automatically.');}
  finally{this.busy=false;}
 }
}
