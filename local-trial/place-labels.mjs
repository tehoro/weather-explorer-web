import * as THREE from 'three';
import {placeTiles,selectPlaces} from './place-selection.mjs?v=20261123c';
import {meshSightGrid,terrainBlocksSight} from './place-visibility.mjs?v=20261123c';
export class PlaceLabels{
 constructor(camera,context,projectPlace){
  this.camera=camera;this.context=context;this.projectPlace=projectPlace;this.visible=[];this.vector=new THREE.Vector3();this.cache=new Map();this.rows=[];this.selected=new Set();this.key='';this.token=0;this.elapsed=0;this.widths=new Map();
  this.layer=document.createElement('div');this.layer.id='placeLabels';this.layer.setAttribute('aria-label','Named locations');document.body.append(this.layer);
  this.measure=document.createElement('canvas').getContext('2d');this.measure.font='600 13px system-ui';
  fetch('/data/places/manifest.json').then(r=>{if(!r.ok)throw Error('Place-name data unavailable');return r.json();}).then(m=>{this.available=new Set(m.tiles);this.refresh();}).catch(e=>this.error(e));
 }
 error(e){document.getElementById('placesStatus').textContent=e.message;}
 async refresh(){
  if(!this.available)return;const keys=placeTiles(this.context().region,this.available),key=keys.join('/');if(key===this.key)return;this.key=key;const token=++this.token;
  try{
   const rows=[],jobs=[...keys];await Promise.all(Array.from({length:4},async()=>{while(jobs.length&&token===this.token){const k=jobs.shift();let data=this.cache.get(k);if(!data){const r=await fetch('/data/places/'+k+'.json');if(!r.ok)throw Error('Some place-name tiles unavailable');data=await r.json();this.cache.set(k,data);while(this.cache.size>160)this.cache.delete(this.cache.keys().next().value);}rows.push(...data);}}));
   if(token!==this.token)return;this.rows=rows;this.layoutKey=null;this.widths.clear();this.elapsed=1;document.getElementById('placesStatus').textContent='GeoNames · labels adapt to the available space; fewer where settlements are sparse.';
  }catch(e){if(token===this.token){this.key='';this.error(e);}}
 }
 tick(dt){
  this.layout(dt);
  if(this.layer.hidden)return;
  // Reproject only the chosen labels. No terrain sampling, ranking or DOM
  // measurements on this path; positions follow every rendered camera frame.
  const v=this.vector,width=innerWidth,height=innerHeight;this.camera.updateMatrixWorld();
  for(const p of this.visible){
   const world=this.projectPlace(p.lat,p.lon);v.set(world.x,p.world.y+.015,world.z).project(this.camera);
   p.element.hidden=v.z< -1||v.z>1||Math.abs(v.x)>1.05||Math.abs(v.y)>1.05;
   p.element.style.transform=`translate(${(v.x+1)*width/2}px,${(1-v.y)*height/2}px)`;
  }
 }
 layout(dt){
  this.elapsed+=dt;if(this.elapsed<.2)return;this.elapsed=0;
  this.layer.hidden=!document.getElementById('placeNames').checked;if(this.layer.hidden)return;
  const c=this.context(),width=innerWidth,height=innerHeight,blocked=[];
  for(const element of document.querySelectorAll('#settingsPanel,#pointForecast,.brand,#mapClock,#timeline,#playback,footer')){const rect=element.getBoundingClientRect();if(rect.width&&rect.height)blocked.push(rect);}
  this.camera.updateMatrixWorld();
  const key=[...this.camera.matrixWorld.elements,...this.camera.projectionMatrix.elements,c.centre.lat,c.centre.lon,c.terrainRevision,c.focusedPlace?.lat,c.focusedPlace?.lon,width,height,...blocked.flatMap(r=>[r.left,r.top,r.right,r.bottom])].join('/');
  if(key===this.layoutKey)return;this.layoutKey=key;
  const gridMap=new Map(c.terrainMeshes().filter(m=>m.visible&&m.userData.p).map(m=>[m,meshSightGrid(m)])),grids=[...gridMap.values()];
  const groundAt=(x,z)=>{const g=gridMap.get(c.placeMesh(x,z));return g?g.height(x,z):c.ground(x,z);};
  const v=new THREE.Vector3(),candidates=[];
  const focus=c.focusedPlace,rows=[...this.rows];
  if(focus?.name&&!rows.some(r=>Math.abs(r[2]-focus.lat)<.0001&&Math.abs(r[3]-focus.lon)<.0001))rows.push([-1,focus.name,focus.lat,focus.lon,0,0,false]);
  for(const row of rows){const [id,name,lat,lon,population,elevation,capital]=row,position=c.projectPlace(lat,lon);
   // Cheap spatial rejection before projection or terrain sampling.
   if(Math.abs(position.x-c.target.x)>Math.max(25,c.distance*3)||Math.abs(position.z-c.target.z)>Math.max(25,c.distance*3))continue;
   const ground=groundAt(position.x,position.z),y=ground+.015;
   v.set(position.x,y,position.z).project(this.camera);if(v.z<-1||v.z>1||Math.abs(v.x)>1||Math.abs(v.y)>1)continue;
   const x=(v.x+1)*width/2,screenY=(1-v.y)*height/2,labelWidth=this.widths.get(name)??(this.widths.set(name,this.measure.measureText(name).width+4),this.widths.get(name)),box={left:x-labelWidth/2,right:x+labelWidth/2,top:screenY-26,bottom:screenY+4};
   if(box.left<8||box.right>width-8||box.top<8||box.bottom>height-8)continue;
   candidates.push({fixed:!!focus&&Math.abs(lat-focus.lat)<.0001&&Math.abs(lon-focus.lon)<.0001,id,name,lat,lon,population,capital,x,y:screenY,box,proximity:Math.hypot(position.x-c.target.x,position.z-c.target.z)/Math.max(10,c.distance*.5),world:new THREE.Vector3(position.x,ground,position.z)});
  }
  // Visibility ends at the actual town ground point, never the raised text.
  const chosen=selectPlaces(candidates,blocked,this.selected,Math.max(7,Math.min(16,Math.round(width*height/65000))),
   p=>!terrainBlocksSight(this.camera.position,p.world,grids,c.coarseSightGrid),c.orbiting);
  this.selected=new Set(chosen.map(p=>p.id));const existing=new Map([...this.layer.children].map(e=>[Number(e.dataset.id),e]));
  for(const p of chosen){let el=existing.get(p.id);if(!el){el=document.createElement('button');el.className='placeLabel';el.setAttribute('aria-label','Forecast for '+p.name);el.dataset.id=p.id;el.textContent=p.name;this.layer.append(el);}el.onclick=()=>dispatchEvent(new CustomEvent('local-place-select',{detail:{lat:p.lat,lon:p.lon,name:p.name}}));el.style.transform=`translate(${p.x}px,${p.y}px)`;existing.delete(p.id);p.element=el;}
  this.visible=chosen;
  for(const el of existing.values())el.remove();
 }
}
