// Bilateral reconstruction keeps the terrain silhouette sharp. Where a low-resolution
// sample cannot represent the foreground depth, trace that pixel at full quality.
export const composite=`
uniform sampler2D cloudImage;uniform vec2 cloudSize;
void main(){
 vec2 uv=gl_FragCoord.xy/viewport,p=uv*cloudSize-.5,base=floor(p),f=fract(p);
 float depth=texture(terrainDepth,uv).r,total=0.;vec4 sum=vec4(0.);
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec2 q=(base+vec2(float(x),float(y))+.5)/cloudSize;
  float d=texture(terrainDepth,q).r;
  float delta=abs(d-depth);
  float w=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
  w*=((d<1.)==(depth<1.))?exp(-delta*12000.):0.;
  vec4 c=texture(cloudImage,q);sum+=vec4(c.rgb*c.a,c.a)*w;total+=w;
 }
 if(total<.15){traceCloud();return;}
 sum/=total;if(sum.a<.002)discard;
 fragColor=linearToOutputTexel(vec4(sum.rgb/sum.a,sum.a));
}`;
