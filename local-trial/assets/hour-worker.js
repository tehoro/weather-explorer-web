function cloudLevelSelected(level,selected){return selected==='all'||selected==='low'&&level>=700||selected==='middle'&&level<700&&level>=400||selected==='high'&&level<400||Number(selected)===level;}
// Approximate cloud bands in pressure coordinates; interpolate between sampled
// levels to keep the continuous volume free from artificial horizontal seams.
function cloudBaseThreshold(level){return level>800?90:level>450?75:60;}
function scaledCloudThreshold(base,middle){return Math.max(0,Math.min(100,base*middle/75));}
function cloudColumnBounds(layers,i){
 const heights=layers.map(l=>l.height[i]??44330*(1-Math.pow(l.level/1013.25,.1903)));
 return heights.map((h,k)=>({height:h,lower:k?(heights[k-1]+h)/2:Math.max(0,h-(heights[k+1]-h)/2),upper:k<heights.length-1?(h+heights[k+1])/2:h+(h-heights[k-1])/2}));
}
// Cloud-cover mode uses three schematic bands, independently of RH thresholds.
// Fractions control opacity; band edges are illustrative, not cloud-base forecasts.
function packCover(data,ny){
 const {grid:g,cloud_cover:cover}=data,nx=g.nx,nz=g.ny,top=12000;
 const voxels=new Uint8Array(nx*ny*nz*4);
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const i=z*nx+x,ground=Math.max(0,data.terrain?.[i]||0);
  const bands=[[ground+400,ground+1900,cover.lcc[i]],
   [Math.max(3000,ground+2100),Math.max(5500,ground+3500),cover.mcc[i]],
   [8000,11000,cover.hcc[i]]];
  for(let y=0;y<ny;y++){
   const height=y/(ny-1)*top;let amount=0;
   for(const [lo,hi,fraction]of bands){
    const edge=Math.max(0,Math.min(1,(height-lo)/250,(hi-height)/250));
    amount=Math.max(amount,Math.max(0,Math.min(1,fraction))*edge);
   }
   const k=((z*ny+y)*nx+x)*4;voxels[k]=255;voxels[k+1]=Math.round(amount*255);
  }
 }
 return {voxels,top,ny,nx,nz};
}
function pack(data,selected,ny){
 if(selected==='cover')return packCover(data,ny);
 const g=data.grid,layers=data.layers,nx=g.nx,nz=g.ny,columns=[],chosen=layers.map(l=>cloudLevelSelected(l.level,selected));
 let top=1;
 for(let i=0;i<nx*nz;i++){
  const bounds=cloudColumnBounds(layers,i);columns.push(bounds);
  for(let k=0;k<layers.length;k++)if(chosen[k]&&layers[k].height[i]!==null)top=Math.max(top,bounds[k].upper);
 }
 const voxels=new Uint8Array(nx*ny*nz*4);
 // Resample the slightly non-uniform exported edge rows onto a regular texture.
 const axisMap=(axis,n)=>Array.from({length:n},(_,i)=>{const value=i/(n-1)-.5;let j=0;while(j<axis.length-2&&axis[j+1]<value)j++;return [j,(value-axis[j])/(axis[j+1]-axis[j])];});
 const mx=axisMap(g.x,nx),mz=axisMap(g.y,nz),raw=new Float32Array(nx*ny*nz*4);
 for(let i=0;i<nx*nz;i++){
  if(!g.valid[i])continue;
  const bounds=columns[i];let k=0;
  for(let y=0;y<ny;y++){
   const height=y/(ny-1)*top;
   while(k<layers.length-1&&height>bounds[k].upper)k++;
   if(!chosen[k]||height<bounds[k].lower||height>bounds[k].upper||layers[k].rh[i]===null)continue;
   const b=bounds[k],rh=layers[k].rh[i];let humidity=rh,base=cloudBaseThreshold(layers[k].level);
   // Interpolate RH between centres, retaining continuous adjacent selected levels.
   const neighbour=height<b.height?k-1:k+1;
   if(neighbour>=0&&neighbour<layers.length&&layers[neighbour].rh[i]!==null){
    const f=Math.min(1,Math.abs((height-b.height)/(bounds[neighbour].height-b.height)));
    humidity=rh+(layers[neighbour].rh[i]-rh)*f;
    base+=(cloudBaseThreshold(layers[neighbour].level)-base)*f;
   }
   let coverage=1;
   // Feather only the outside of a selection, never seams between adjacent levels.
   if(k===0||!chosen[k-1]||layers[k-1].rh[i]===null)coverage*=Math.min(1,Math.max(0,(height-b.lower)/Math.max(40,(b.height-b.lower)*.3)));
   if(k===layers.length-1||!chosen[k+1]||layers[k+1].rh[i]===null)coverage*=Math.min(1,Math.max(0,(b.upper-height)/Math.max(40,(b.upper-b.height)*.3)));
   const offset=((Math.floor(i/nx)*ny+y)*nx+i%nx)*4;raw[offset]=humidity;raw[offset+1]=coverage;raw[offset+2]=base;
  }
 }
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const [ix,fx]=mx[x],[iz,fz]=mz[z];
  for(let y=0;y<ny;y++){
   const dest=((z*ny+y)*nx+x)*4;let humidity=0,coverage=0,base=0;
   for(const [dx,dz,w] of [[0,0,(1-fx)*(1-fz)],[1,0,fx*(1-fz)],[0,1,(1-fx)*fz],[1,1,fx*fz]]){
    const offset=(((iz+dz)*ny+y)*nx+ix+dx)*4,c=raw[offset+1];coverage+=w*c;humidity+=w*c*raw[offset];base+=w*c*raw[offset+2];
   }
   voxels[dest]=Math.round(coverage?humidity/coverage/100*255:0);voxels[dest+1]=Math.round(coverage*255);voxels[dest+2]=Math.round(coverage?base/coverage/100*255:0);
  }
 }

 return {voxels,top,ny,nx,nz};
}
self.onmessage=async({data:m})=>{
 try{
  if(m.url){
   const r=await fetch(m.url);if(!r.ok)throw Error('Weather request failed: '+r.status);
   const value=await r.json(),transfer=[];
   for(const key of Object.keys(value))if(Array.isArray(value[key])){
    const a=Float32Array.from(value[key],v=>v===null?NaN:v);value[key]=a;transfer.push(a.buffer);
   }
   self.postMessage({id:m.id,value},transfer);
  }else{
   const value=pack(m.data,m.selected,m.ny);self.postMessage({id:m.id,value},[value.voxels.buffer]);
  }
 }catch(e){self.postMessage({id:m.id,error:String(e)});}
};
