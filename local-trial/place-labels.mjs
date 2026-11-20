import * as THREE from 'three';
import {placeTiles,selectPlaces} from './place-selection.mjs?v=20261120f';
export class PlaceLabels{
 constructor(camera,context){
  this.camera=camera;this.context=context;this.cache=new Map();this.rows=[];this.selected=new Set();this.key='';this.token=0;this.elapsed=0;
  this.layer=document.createElement('div');this.layer.id='placeLabels';this.layer.setAttribute('aria-label','Named locations');document.body.append(this.layer);
  this.measure=document.createElement('canvas').getContext('2d');this.measure.font='600 17px system-ui';
  fetch('/data/places/manifest.json').then(r=>{if(!r.ok)throw Error('Place-name data unavailable');return r.json();}).then(m=>{this.available=new Set(m.tiles);this.refresh();}).catch(e=>this.error(e));
 }
 error(e){document.getElementById('placesStatus').textContent=e.message;}
 async refresh(){
  if(!this.available)return;const keys=placeTiles(this.context().region,this.available),key=keys.join('/');if(key===this.key)return;this.key=key;const token=++this.token;
  try{
   const rows=[],jobs=[...keys];await Promise.all(Array.from({length:4},async()=>{while(jobs.length&&token===this.token){const k=jobs.shift();let data=this.cache.get(k);if(!data){const r=await fetch('/data/places/'+k+'.json');if(!r.ok)throw Error('Some place-name tiles unavailable');data=await r.json();this.cache.set(k,data);while(this.cache.size>160)this.cache.delete(this.cache.keys().next().value);}rows.push(...data);}}));
   if(token!==this.token)return;this.rows=rows;this.elapsed=1;document.getElementById('placesStatus').textContent='GeoNames · about five visible labels; fewer where settlements are sparse.';
  }catch(e){if(token===this.token){this.key='';this.error(e);}}
 }
 tick(dt){
  this.elapsed+=dt;if(this.elapsed<.2)return;this.elapsed=0;
  this.layer.hidden=!document.getElementById('placeNames').checked;if(this.layer.hidden)return;
  const c=this.context(),width=innerWidth,height=innerHeight,blocked=[];
  for(const element of document.querySelectorAll('#settingsPanel,.brand,#mapClock,#timeline,#playback,footer')){const rect=element.getBoundingClientRect();if(rect.width&&rect.height)blocked.push(rect);}
  this.camera.updateMatrixWorld();const v=new THREE.Vector3(),candidates=[];
  for(const row of this.rows){const [id,name,lat,lon,population,elevation,capital]=row,position=c.projectPlace(lat,lon);
   // Cheap spatial rejection before projection or terrain sampling.
   if(Math.abs(position.x-c.target.x)>950||Math.abs(position.z-c.target.z)>950)continue;
   const ground=c.ground(position.x,position.z),y=Math.max(ground,Math.max(0,elevation)*.0015)+.15;
   v.set(position.x,y,position.z).project(this.camera);if(v.z<-1||v.z>1||Math.abs(v.x)>1||Math.abs(v.y)>1)continue;
   const x=(v.x+1)*width/2,screenY=(1-v.y)*height/2,labelWidth=this.measure.measureText(name).width+23,box={left:x-5,right:x+labelWidth,top:screenY-12,bottom:screenY+13};
   if(box.left<8||box.right>width-8||box.top<8||box.bottom>height-8)continue;
   candidates.push({id,name,population,capital,x,y:screenY,box,world:new THREE.Vector3(position.x,y,position.z)});
  }
  // Check the highest-ranked candidates against intervening terrain, not clouds.
  let pool=candidates,chosen=[];
  for(let pass=0;pass<3;pass++){
   chosen=selectPlaces(pool,blocked,this.selected);const hidden=new Set();
   for(const p of chosen){for(let i=1;i<16;i++){const t=i/16,x=this.camera.position.x+(p.world.x-this.camera.position.x)*t,z=this.camera.position.z+(p.world.z-this.camera.position.z)*t,y=this.camera.position.y+(p.world.y-this.camera.position.y)*t;if(c.ground(x,z)>y+.08){hidden.add(p.id);break;}}}
   if(!hidden.size)break;pool=pool.filter(p=>!hidden.has(p.id));chosen=chosen.filter(p=>!hidden.has(p.id));
  }
  this.selected=new Set(chosen.map(p=>p.id));const existing=new Map([...this.layer.children].map(e=>[Number(e.dataset.id),e]));
  for(const p of chosen){let el=existing.get(p.id);if(!el){el=document.createElement('div');el.className='placeLabel';el.dataset.id=p.id;el.textContent=p.name;this.layer.append(el);}el.style.transform=`translate(${p.x}px,${p.y}px)`;existing.delete(p.id);}
  for(const el of existing.values())el.remove();
 }
}
