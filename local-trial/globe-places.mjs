import * as THREE from 'three';
import {selectPlaces,placeTiles} from './place-selection.mjs';
export class GlobePlaces{
 constructor(host,globe,camera,vector,choose){
  Object.assign(this,{host,globe,camera,vector,choose});this.rows=[];this.cache=new Map();this.selected=new Set();this.elapsed=0;this.region='';this.positions=new Map();
  this.layer=document.createElement('div');this.layer.id='globePlaces';host.append(this.layer);
  this.measure=document.createElement('canvas').getContext('2d');this.measure.font='600 13px system-ui';
  fetch('data/places/overview.json').then(r=>r.json()).then(r=>this.rows=r);
  fetch('data/places/manifest.json').then(r=>r.json()).then(m=>this.available=new Set(m.tiles));
 }
 async nearby(local){
  if(!this.available||this.camera.position.length()>1.65)return;
  const lat=Math.asin(local.y)*180/Math.PI,lon=Math.atan2(-local.z,local.x)*180/Math.PI;
  const keys=placeTiles({west:lon-20,north:Math.min(90,lat+15),lonSpan:40,latSpan:30},this.available),key=keys.join('/');if(key===this.region)return;this.region=key;
  const jobs=keys.filter(k=>!this.cache.has(k));
  await Promise.all(Array.from({length:3},async()=>{while(jobs.length){const k=jobs.shift();try{const r=await fetch(`data/places/${k}.json`);if(r.ok)this.cache.set(k,await r.json());}catch{}}}));
  while(this.cache.size>160)this.cache.delete(this.cache.keys().next().value);
 }
 tick(dt){
  this.camera.updateMatrixWorld();this.globe.updateMatrixWorld();
  // Keep selected labels glued to their geographic points on every rendered frame.
  for(const el of this.layer.children){const row=this.positions.get(el.dataset.id);if(!row)continue;const world=this.vector(row.lat,row.lon).applyQuaternion(this.globe.quaternion),visible=world.dot(this.camera.position)>1.03,p=world.project(this.camera);el.hidden=!visible||Math.abs(p.x)>1||Math.abs(p.y)>1;el.style.transform=`translate(${(p.x+1)*this.host.clientWidth/2}px,${(1-p.y)*this.host.clientHeight/2}px)`;}
  this.elapsed+=dt;if(this.elapsed<.8)return;this.elapsed=0;
  const local=this.camera.position.clone().normalize().applyQuaternion(this.globe.quaternion.clone().invert());this.nearby(local);
  const width=this.host.clientWidth,height=this.host.clientHeight,origin=this.host.getBoundingClientRect(),blocked=[];
  for(const id of ['chooser','globeClock','spinToggle']){const r=document.getElementById(id).getBoundingClientRect();blocked.push({left:r.left-origin.left,right:r.right-origin.left,top:r.top-origin.top,bottom:r.bottom-origin.top});}
  const rows=new Map(this.rows.map(r=>[r[0],r]));if(this.camera.position.length()<1.65)for(const list of this.cache.values())for(const r of list)rows.set(r[0],r);
  const candidates=[];
  for(const [id,name,lat,lon,population,,capital]of rows.values()){
   const world=this.vector(lat,lon).applyQuaternion(this.globe.quaternion);
   if(world.dot(this.camera.position)<=1.03)continue;const p=world.project(this.camera);
   const x=(p.x+1)*width/2,y=(1-p.y)*height/2,w=this.measure.measureText(name).width+4;
   if(p.z>1||x-w/2<8||y<26||x+w/2>width-8||y>height-8)continue;
   candidates.push({id,name,lat,lon,population:population*(this.selected.has(id)?8:1),capital,x,y,box:{left:x-w/2,right:x+w/2,top:y-26,bottom:y+4}});
  }
  const selected=selectPlaces(candidates,blocked,this.selected,Math.max(7,Math.min(14,Math.round(width*height/65000))));this.selected=new Set(selected.map(p=>p.id));
  // Preserve buttons so rotation does not replace a focused/clicked element.
  const keep=new Set(selected.map(p=>String(p.id)));
  for(const el of [...this.layer.children])if(!keep.has(el.dataset.id)&&el!==document.activeElement)el.remove();
  for(const p of selected){this.positions.set(String(p.id),p);let el=this.layer.querySelector(`[data-id="${p.id}"]`);if(!el){el=document.createElement('button');el.dataset.id=p.id;el.textContent=p.name;el.onclick=()=>this.choose(p.lat,p.lon,p.name);this.layer.append(el);}el.style.transform=`translate(${p.x}px,${p.y}px)`;}
 }
}
