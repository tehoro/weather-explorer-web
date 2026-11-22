// Move the head every render; retain evenly spaced history at 30 Hz.
export function advanceWindHistory(p,elapsed,firstSample,height){
 const head=p.history[0],x0=head[0],z0=head[2];
 for(let t=firstSample;t<=elapsed;t+=1/30){
  const f=t/elapsed,x=x0+(p.x-x0)*f,z=z0+(p.z-z0)*f,point=p.history.pop();
  point[0]=x;point[1]=height(x,z);point[2]=z;p.history.splice(1,0,point);
 }
 head[0]=p.x;head[1]=height(p.x,p.z);head[2]=p.z;
}
